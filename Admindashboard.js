onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      window.location.replace("EmployeeLogin.html");
      return;
    }

    // 🔴 بدل doc مباشرة → نستخدم Query لأن الـ docId مو uid
    const q = query(
      collection(db, "employees"),
      where("email", "==", user.email)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
      return;
    }

    const data = snap.docs[0].data();

    if (!data.isAdmin) {
      await signOut(auth);
      window.location.replace("EmployeeLogin.html");
      return;
    }

    currentAdminData = data;

     const adminNameEl = document.getElementById("adminName");

    if (adminNameEl) {
      adminNameEl.textContent = `مرحبا، ${data.fullName ?? "الأدمن"} 👋`;
    }
    

    setDates();
    await loadAllData();

  } catch (err) {
    console.error("Auth error:", err);
    await signOut(auth);
    window.location.replace("EmployeeLogin.html");
  }
 document.getElementById("logoutBtn").addEventListener("click", async function() {
   await signOut(auth);
   window.location.href = "EmployeeLogin.html";
 });

});