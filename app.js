const $ = (id) => document.getElementById(id);
let currentUser = null;
let studentsData = [];
let reportRows = [];
let chart = null;
let deferredPrompt = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js");
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $("installBtn");
  if (btn) btn.classList.remove("hidden");
});

document.addEventListener("DOMContentLoaded", prefillLastLogin);

window.addEventListener("load", () => {
  const btn = $("installBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.classList.add("hidden");
    });
  }
  if ($("aDate")) $("aDate").valueAsDate = new Date();
});

function toast(msg){
  const t = $("toast");
  t.innerText = msg;
  t.style.display = "block";
  setTimeout(()=>t.style.display="none",2500);
}

async function login(){
  const role = $("loginRole").value;
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value.trim();

  if(role === "admin"){
    if(username === "admin" && password === "admin123"){
      currentUser = { role, username, department:"", year:"" };
      rememberLogin(role, username, password);
      enterApp();
      return;
    }
    alert("Wrong username or password"); return;
  }

  try{
    const snap = await db.collection("users")
      .where("username","==",username)
      .where("password","==",password)
      .where("role","==",role)
      .limit(1).get();
    if(snap.empty){ alert("Wrong username or password"); return; }
    const u = snap.docs[0].data();
    currentUser = { role, username, department:u.department || "", year:u.year || "" };
    rememberLogin(role, username, password);
    enterApp();
  }catch(err){ alert("Login error: " + err.message); console.error(err); }
}

function rememberLogin(role, username, password){
  localStorage.setItem("lastLogin", JSON.stringify({role, username, password}));
}

function prefillLastLogin(){
  const saved = localStorage.getItem("lastLogin");
  if(!saved) return;
  try{
    const {role, username, password} = JSON.parse(saved);
    if($("loginRole")) $("loginRole").value = role;
    if($("loginUsername")) $("loginUsername").value = username;
    if($("loginPassword")) $("loginPassword").value = password;
  }catch(e){ /* ignore corrupt data */ }
}

function enterApp(){
  $("loginPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");
  $("currentUser").innerText = currentUser.role.toUpperCase() + " - " + currentUser.username +
    (currentUser.department ? ` (${currentUser.department}${currentUser.year ? ", "+currentUser.year : ""})` : "");
  applyRoleAccess();
  if(currentUser.role === "admin" || currentUser.role === "hod") checkAndRunPromotion();
  if(currentUser.role === "staff") initStaffNotifications();
}

function applyRoleAccess(){
  const role = currentUser.role;
  const access = {
    admin:  { navDashboard:1, navStudents:1, navAttendance:1, navReports:1, navNotifications:1, navTimetable:1, navAlumni:1, navSettings:1, usersNavBtn:1, landing:"dashboard" },
    hod:    { navDashboard:1, navStudents:1, navAttendance:1, navReports:1, navNotifications:1, navTimetable:1, navAlumni:1, navSettings:1, usersNavBtn:0, landing:"dashboard" },
    staff:  { navDashboard:0, navStudents:0, navAttendance:1, navReports:0, navNotifications:0, navTimetable:1, navAlumni:0, navSettings:0, usersNavBtn:0, landing:"attendance" },
    cr:     { navDashboard:0, navStudents:1, navAttendance:0, navReports:0, navNotifications:0, navTimetable:0, navAlumni:0, navSettings:0, usersNavBtn:0, landing:"students" }
  };
  const rules = access[role] || access.staff;
  ["navDashboard","navStudents","navAttendance","navReports","navNotifications","navTimetable","navAlumni","navSettings","usersNavBtn"].forEach(id=>{
    $(id).classList.toggle("hidden", !rules[id]);
  });
  showPage(rules.landing);
}

function logout(){ location.reload(); }

function lockDeptYear(deptId, yearId){
  if($(deptId)) $(deptId).disabled = false;
  if($(yearId)) $(yearId).disabled = false;
}

function showPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  $(page).classList.remove("hidden");
  $("pageTitle").innerText = page.charAt(0).toUpperCase()+page.slice(1);
  if(page==="dashboard") loadDashboard();
  if(page==="students"){ lockDeptYear("filterDept","filterYear"); lockDeptYear("sDept","sYear"); loadStudents(); }
  if(page==="attendance") lockDeptYear("aDept","aYear");
  if(page==="reports") generateReport();
  if(page==="settings"){ firebaseCheck(); loadPromotionStatus(); }
  if(page==="users") loadUsers();
  if(page==="timetable") loadMyTimetable();
  if(page==="alumni") loadAlumni();
}

async function saveStudent(){
  try{
    const photoFile = $("sPhoto").files[0];
    let photoURL = "";
    const student = {
      name:$("sName").value.trim(), roll:$("sRoll").value.trim(), regNo:$("sReg").value.trim(),
      department:$("sDept").value, year:$("sYear").value, section:$("sSection").value.trim(),
      phone:$("sPhone").value.trim(), parentPhone:$("sParentPhone").value.trim(),
      email:$("sEmail").value.trim(), address:$("sAddress").value.trim(),
      createdAt:new Date().toISOString(), week:getWeekKey(new Date()),
      month:new Date().toLocaleString("en-US",{month:"short",year:"numeric"})
    };
    if(!student.name || !student.roll || !student.department || !student.year || !student.parentPhone){
      alert("Name, Roll, Department, Year, Parent Phone required"); return;
    }
    if(photoFile){
      const ref = storage.ref("student_photos/" + Date.now() + "_" + photoFile.name);
      await ref.put(photoFile);
      photoURL = await ref.getDownloadURL();
    }
    student.photoURL = photoURL;
    await db.collection("students").add(student);
    toast("Student saved in Firebase ✅");
    document.querySelectorAll("#students input").forEach(i=>i.value="");
    $("sDept").value=""; $("sYear").value="";
    loadStudents();
  }catch(err){ alert("Firebase save error: " + err.message); console.error(err); }
}

async function loadStudents(){
  try{
    const snap = await db.collection("students").orderBy("roll","asc").get();
    let students = snap.docs.map(d=>({id:d.id,...d.data()}));
    const dept = $("filterDept") ? $("filterDept").value : "";
    const year = $("filterYear") ? $("filterYear").value : "";
    const search = $("searchStudent") ? $("searchStudent").value.toLowerCase() : "";
    if(dept) students = students.filter(s=>s.department===dept);
    if(year) students = students.filter(s=>s.year===year);
    if(search) students = students.filter(s=>(s.name||"").toLowerCase().includes(search) || (s.roll||"").toLowerCase().includes(search));
    studentsData = students;
    $("studentTable").innerHTML = students.map(s=>`
      <tr>
        <td>${s.photoURL ? `<img class="avatar" src="${s.photoURL}"/>` : "👤"}</td>
        <td>${s.name}</td><td>${s.roll}</td><td>${s.department}</td><td>${s.year}</td><td>${s.parentPhone}</td>
        <td><button class="sms" onclick="sendSMS('${s.parentPhone}','${s.name}')">SMS</button>
        <button class="wa" onclick="sendWhatsApp('${s.parentPhone}','${s.name}')">WhatsApp</button></td>
      </tr>`).join("");
  }catch(err){ alert("Load students error: " + err.message); console.error(err); }
}

function getSelectedPeriods(){
  return [...document.querySelectorAll("#periodChecks input:checked")].map(c=>c.value);
}

async function loadAttendanceStudents(){
  await loadStudents();
  const dept = $("aDept").value, year = $("aYear").value, subject = $("aSubject").value.trim();
  const periods = getSelectedPeriods();
  const list = studentsData.filter(s=>s.department===dept && s.year===year);
  if(!$("aDate").value) $("aDate").valueAsDate = new Date();
  if(!dept || !year || !subject){ alert("Date, Subject, Department, Year required"); return; }
  if(periods.length===0){ alert("Select at least one Period (1 to 5)"); return; }
  if(list.length===0){ $("attendanceList").innerHTML = "<p>No students found.</p>"; return; }
  $("attendanceList").innerHTML = list.map(s=>`
    <div class="row-card"><span><b>${s.name}</b> (${s.roll})</span>
    <select data-id="${s.id}" data-name="${s.name}" data-roll="${s.roll}">
      <option value="Present">Present</option><option value="Absent">Absent</option>
    </select></div>`).join("");
}

async function saveAttendance(){
  try{
    const date = $("aDate").value, subject = $("aSubject").value.trim(), department = $("aDept").value, year = $("aYear").value;
    const periods = getSelectedPeriods();
    const rows = [...document.querySelectorAll("#attendanceList select")];
    if(!date || !subject || !department || !year || rows.length===0){ alert("Load students first"); return; }
    if(periods.length===0){ alert("Select at least one Period (1 to 5)"); return; }
    for(const r of rows){
      for(const period of periods){
        await db.collection("attendance").add({
          studentId:r.dataset.id, name:r.dataset.name, roll:r.dataset.roll, status:r.value,
          date, subject, department, year, period, markedBy: currentUser ? currentUser.username : "admin",
          createdAt:new Date().toISOString(), week:getWeekKey(new Date(date)),
          month:new Date(date).toLocaleString("en-US",{month:"short",year:"numeric"})
        });
      }
    }
    toast(`Attendance saved for ${periods.length} period(s) ✅`);
    $("attendanceList").innerHTML="";
    document.querySelectorAll("#periodChecks input").forEach(c=>c.checked=false);
    loadDashboard();
  }catch(err){ alert("Attendance save error: " + err.message); console.error(err); }
}

async function loadDashboard(){
  const sSnap = await db.collection("students").get();
  const aSnap = await db.collection("attendance").get();
  const students = sSnap.docs.map(d=>d.data());
  const attendance = aSnap.docs.map(d=>d.data());
  $("totalStudents").innerText = students.length;
  $("totalPresent").innerText = attendance.filter(a=>a.status==="Present").length;
  $("totalAbsent").innerText = attendance.filter(a=>a.status==="Absent").length;
  const avg = attendance.length ? Math.round((attendance.filter(a=>a.status==="Present").length / attendance.length)*100) : 0;
  $("avgPercent").innerText = avg + "%";
  renderDashboardChart(attendance, students);
}

async function generateReport(){
  const sSnap = await db.collection("students").get();
  const aSnap = await db.collection("attendance").get();
  let students = sSnap.docs.map(d=>({id:d.id,...d.data()}));
  const attendance = aSnap.docs.map(d=>d.data());
  const dept = $("rDept").value, year = $("rYear").value, subject = $("rSubject").value.toLowerCase();
  const period = $("rPeriod") ? $("rPeriod").value : "";
  if(dept) students = students.filter(s=>s.department===dept);
  if(year) students = students.filter(s=>s.year===year);
  reportRows = students.map(s=>{
    let rec = attendance.filter(a=>a.studentId===s.id);
    if(subject) rec = rec.filter(a=>(a.subject||"").toLowerCase().includes(subject));
    if(period) rec = rec.filter(a=>a.period===period);
    const present = rec.filter(a=>a.status==="Present").length;
    const absent = rec.filter(a=>a.status==="Absent").length;
    const total = rec.length;
    const percentage = total ? Math.round((present/total)*100) : 0;
    return {name:s.name, roll:s.roll, present, absent, total, percentage:percentage+"%"};
  });
  $("reportTable").innerHTML = reportRows.map(r=>`
    <tr><td>${r.name}</td><td>${r.roll}</td><td>${r.present}</td><td>${r.absent}</td><td>${r.total}</td><td>${r.percentage}</td></tr>`).join("");
}

function downloadCSV(){
  if(!reportRows.length){ alert("Generate report first"); return; }
  const header = "Name,Roll,Present,Absent,Total,Percentage\n";
  const body = reportRows.map(r=>`${r.name},${r.roll},${r.present},${r.absent},${r.total},${r.percentage}`).join("\n");
  const blob = new Blob([header+body], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "attendance-report.csv"; a.click();
}

function sendSMS(phone, name){
  const msg = encodeURIComponent(`Dear Parent, ${name} attendance/student details updated in Madha Attendance App.`);
  window.location.href = `sms:${phone}?body=${msg}`;
}
function sendWhatsApp(phone, name){
  const msg = encodeURIComponent(`Dear Parent, ${name} attendance/student details updated in Madha Attendance App.`);
  window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
}

async function firebaseCheck(){
  const sSnap = await db.collection("students").limit(20).get();
  const aSnap = await db.collection("attendance").limit(20).get();
  const data = {students:sSnap.docs.map(d=>({id:d.id,...d.data()})), attendance:aSnap.docs.map(d=>({id:d.id,...d.data()}))};
  $("firebaseOutput").innerText = JSON.stringify(data, null, 2);
}

async function saveUser(){
  try{
    const role = $("uRole").value, username = $("uUsername").value.trim(), password = $("uPassword").value.trim();
    const department = $("uDept").value, year = $("uYear").value;
    if(!username || !password || !department){ alert("Username, Password, Department required"); return; }
    const existing = await db.collection("users").where("username","==",username).limit(1).get();
    if(!existing.empty){ alert("Username already exists"); return; }
    await db.collection("users").add({ role, username, password, department, year, createdAt:new Date().toISOString() });
    toast("Login created ✅");
    $("uUsername").value=""; $("uPassword").value=""; $("uDept").value=""; $("uYear").value="";
    loadUsers();
  }catch(err){ alert("Create login error: " + err.message); console.error(err); }
}

async function loadUsers(){
  try{
    const snap = await db.collection("users").orderBy("createdAt","desc").get();
    const users = snap.docs.map(d=>({id:d.id,...d.data()}));
    $("userTable").innerHTML = users.map(u=>`
      <tr><td>${u.username}</td><td>${u.role.toUpperCase()}</td><td>${u.department}</td><td>${u.year||"All"}</td>
      <td><button onclick="deleteUser('${u.id}')">Delete</button></td></tr>`).join("");
  }catch(err){ alert("Load logins error: " + err.message); console.error(err); }
}

async function deleteUser(id){
  if(!confirm("Delete this login?")) return;
  await db.collection("users").doc(id).delete();
  toast("Login deleted");
  loadUsers();
}

function getWeekKey(date){
  const first = new Date(date.getFullYear(),0,1);
  const days = Math.floor((date - first)/(24*60*60*1000));
  return "Week " + Math.ceil((days + first.getDay() + 1)/7);
}

// ==========================================================
// YEAR PROMOTION (I Year -> II Year -> III Year -> Passed Out)
// Runs automatically once every year on/after June 1st.
// ==========================================================
const NEXT_YEAR_MAP = { "I Year":"II Year", "II Year":"III Year" };

async function loadPromotionStatus(){
  try{
    const doc = await db.collection("settings").doc("academic").get();
    const data = doc.exists ? doc.data() : {};
    $("lastPromotionYear").innerText = data.lastPromotionYear
      ? `${data.lastPromotionYear} (${new Date(data.lastRunAt).toLocaleDateString()})`
      : "Never run yet";
  }catch(err){ console.error("loadPromotionStatus error:", err); }
}

async function checkAndRunPromotion(){
  try{
    const today = new Date();
    const promotionDate = new Date(today.getFullYear(), 5, 1); // June 1
    const doc = await db.collection("settings").doc("academic").get();
    const lastYear = doc.exists ? (doc.data().lastPromotionYear || 0) : 0;
    if(today >= promotionDate && lastYear < today.getFullYear()){
      const ok = confirm(`New academic year detected (June 1, ${today.getFullYear()}).\nPromote all students now?\nI Year -> II Year, II Year -> III Year, III Year -> Passed Out (Alumni).`);
      if(ok) await promoteAllStudents(today.getFullYear());
    }
  }catch(err){ console.error("checkAndRunPromotion error:", err); }
}

async function runPromotionNow(){
  const yearNum = new Date().getFullYear();
  if(!confirm(`Run promotion now?\nI Year -> II Year, II Year -> III Year, III Year -> Passed Out (Alumni).`)) return;
  await promoteAllStudents(yearNum);
}

async function promoteAllStudents(yearNum){
  try{
    toast("Promotion running… please wait");
    const snap = await db.collection("students").get();
    const students = snap.docs.map(d=>({id:d.id, ...d.data()}));
    let batch = db.batch();
    let opCount = 0, promoted = 0, passedOut = 0;
    for(const s of students){
      if(NEXT_YEAR_MAP[s.year]){
        batch.update(db.collection("students").doc(s.id), { year: NEXT_YEAR_MAP[s.year] });
        opCount++; promoted++;
      } else if(s.year === "III Year"){
        const { id, ...rest } = s;
        batch.set(db.collection("passedOut").doc(id), { ...rest, passOutYear: yearNum, promotedAt: new Date().toISOString() });
        batch.delete(db.collection("students").doc(id));
        opCount += 2; passedOut++;
      }
      if(opCount >= 400){ await batch.commit(); batch = db.batch(); opCount = 0; }
    }
    if(opCount > 0) await batch.commit();
    await db.collection("settings").doc("academic").set({ lastPromotionYear: yearNum, lastRunAt: new Date().toISOString() }, { merge:true });
    toast(`Promotion done ✅ ${promoted} promoted, ${passedOut} passed out`);
    loadPromotionStatus();
    if($("students") && !$("students").classList.contains("hidden")) loadStudents();
  }catch(err){ alert("Promotion error: " + err.message); console.error(err); }
}

// ==========================================================
// ALUMNI (Passed Out students archive)
// ==========================================================
async function loadAlumni(){
  try{
    const snap = await db.collection("passedOut").orderBy("promotedAt","desc").get();
    let alumni = snap.docs.map(d=>({id:d.id,...d.data()}));
    const dept = $("alumniDept") ? $("alumniDept").value : "";
    const search = $("alumniSearch") ? $("alumniSearch").value.toLowerCase() : "";
    if(dept) alumni = alumni.filter(a=>a.department===dept);
    if(search) alumni = alumni.filter(a=>(a.name||"").toLowerCase().includes(search) || (a.roll||"").toLowerCase().includes(search));
    $("alumniTable").innerHTML = alumni.map(a=>`
      <tr><td>${a.name}</td><td>${a.roll}</td><td>${a.department}</td><td>${a.passOutYear||""}</td><td>${a.parentPhone||""}</td></tr>`).join("");
  }catch(err){ alert("Load alumni error: " + err.message); console.error(err); }
}

// ==========================================================
// STAFF TIMETABLE (Firebase Firestore, collection "timetable")
// ==========================================================
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const PERIOD_TIMES = {
  "Period 1": ["09:00","10:00"], "Period 2": ["10:00","11:00"], "Period 3": ["11:00","12:00"],
  "Period 4": ["12:00","13:00"], "Period 5": ["13:00","14:00"]
};

async function saveTimetableEntry(){
  try{
    const period = $("ttPeriod").value;
    const [startTime, endTime] = PERIOD_TIMES[period];
    const entry = {
      staffUsername: currentUser.username, staffName: currentUser.username,
      dayOfWeek: parseInt($("ttDay").value), period, startTime, endTime,
      department: $("ttDept").value, year: $("ttYear").value,
      section: $("ttSection").value.trim(), subject: $("ttSubject").value.trim(),
      createdAt: new Date().toISOString()
    };
    if(!entry.department || !entry.year || !entry.subject){ alert("Department, Year, Subject required"); return; }
    await db.collection("timetable").add(entry);
    toast("Timetable entry saved ✅");
    $("ttSection").value=""; $("ttSubject").value="";
    loadMyTimetable();
    if(currentUser.role === "staff") initStaffNotifications();
  }catch(err){ alert("Timetable save error: " + err.message); console.error(err); }
}

async function loadMyTimetable(){
  try{
    const snap = await db.collection("timetable").where("staffUsername","==",currentUser.username).get();
    const data = snap.docs.map(d=>({id:d.id, ...d.data()}))
      .sort((a,b)=> a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
    $("timetableTable").innerHTML = data.map(t=>`
      <tr><td>${DAY_NAMES[t.dayOfWeek]}</td><td>${t.period}</td><td>${t.department}</td><td>${t.year}</td><td>${t.section||"-"}</td><td>${t.subject}</td>
      <td><button onclick="deleteTimetableEntry('${t.id}')">Delete</button></td></tr>`).join("");
  }catch(err){ alert("Load timetable error: " + err.message); console.error(err); }
}

async function deleteTimetableEntry(id){
  if(!confirm("Delete this timetable entry?")) return;
  await db.collection("timetable").doc(id).delete();
  toast("Deleted");
  loadMyTimetable();
  if(currentUser.role === "staff") initStaffNotifications();
}

// ==========================================================
// "GO TO CLASS" NOTIFICATIONS
// Checks today's timetable and schedules an alert 5 minutes
// before each period starts, while the app tab is open.
// ==========================================================
let scheduledTimers = [];
let pendingClassAlert = null;

function clearScheduledTimers(){
  scheduledTimers.forEach(t=>clearTimeout(t));
  scheduledTimers = [];
}

async function initStaffNotifications(){
  clearScheduledTimers();
  if("Notification" in window && Notification.permission === "default"){
    try{ await Notification.requestPermission(); }catch(e){ /* ignore */ }
  }
  try{
    const today = new Date();
    const dow = today.getDay();
    const snap = await db.collection("timetable")
      .where("staffUsername","==",currentUser.username)
      .where("dayOfWeek","==",dow).get();
    snap.docs.forEach(d=>{
      const entry = { id: d.id, ...d.data() };
      const [h,m] = entry.startTime.split(":").map(Number);
      const startAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0);
      const fireAt = new Date(startAt.getTime() - 5*60000); // 5 min before period
      const delay = fireAt.getTime() - Date.now();
      if(delay > 0 && delay < 24*60*60*1000){
        scheduledTimers.push(setTimeout(()=>fireClassNotification(entry), delay));
      }
    });
  }catch(err){ console.error("Notification schedule error:", err); }
}

function fireClassNotification(entry){
  const msg = `${entry.subject} - ${entry.period} - ${entry.year} ${entry.department}${entry.section ? " "+entry.section : ""} ku pogunga!`;
  pendingClassAlert = entry;
  $("classAlertText").innerText = msg;
  $("classAlert").classList.remove("hidden");
  if("Notification" in window && Notification.permission === "granted"){
    const n = new Notification("Go to Class", { body: msg, icon: "icon-192.png" });
    n.onclick = () => { window.focus(); goToClassFromAlert(); };
  }
  try{ db.collection("notification_log").add({ timetableId: entry.id, staffUsername: currentUser.username, message: msg, firedAt: new Date().toISOString() }); }
  catch(e){ /* non-critical */ }
}

function dismissClassAlert(){
  $("classAlert").classList.add("hidden");
  pendingClassAlert = null;
}

function goToClassFromAlert(){
  if(!pendingClassAlert) return;
  const entry = pendingClassAlert;
  $("classAlert").classList.add("hidden");
  showPage("attendance");
  lockDeptYear("aDept","aYear");
  $("aDate").valueAsDate = new Date();
  $("aSubject").value = entry.subject;
  $("aDept").value = entry.department;
  $("aYear").value = entry.year;
  document.querySelectorAll("#periodChecks input").forEach(c=>{ c.checked = (c.value === entry.period); });
  loadAttendanceStudents();
  pendingClassAlert = null;
}

function renderDashboardChart(attendance, students){
  const weekCounts = {}, monthCounts = {};
  attendance.forEach(a=>{ weekCounts[a.week || "Unknown"] = (weekCounts[a.week || "Unknown"] || 0) + 1; monthCounts[a.month || "Unknown"] = (monthCounts[a.month || "Unknown"] || 0) + 1; });
  if(attendance.length===0){ students.forEach(s=>{ weekCounts[s.week || "Students"] = (weekCounts[s.week || "Students"] || 0) + 1; monthCounts[s.month || "Students"] = (monthCounts[s.month || "Students"] || 0) + 1; }); }
  const labels = [...new Set([...Object.keys(weekCounts), ...Object.keys(monthCounts)])].slice(-8);
  const weeklyData = labels.map(l=>weekCounts[l] || 0), monthlyData = labels.map(l=>monthCounts[l] || 0);
  if(chart) chart.destroy();
  chart = new Chart($("dashboardChart"),{type:"bar",data:{labels,datasets:[{label:"Weekly Count",data:weeklyData},{label:"Monthly Count",data:monthlyData}]},options:{responsive:true,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
}