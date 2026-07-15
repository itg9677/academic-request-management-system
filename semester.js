// =====================================================
// semester.js — أداة مشتركة لإدارة الفصل الدراسي الحالي
// تُستخدم من: absence.js, request.js, visitRequest.js,
//             studentMain.js, emp-dashboard.js, Admindashboard.js
// =====================================================

import { db } from "./firebase.js";

import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    query,
    where,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let cachedSemester = null;

/**
 * يجلب بيانات الفصل الحالي من settings/currentSemester
 * مع كاش بسيط بالذاكرة (نفس الجلسة) لتقليل القراءات.
 */
export async function getCurrentSemester(force = false) {
    if (cachedSemester && !force) return cachedSemester;

    try {
        const snap = await getDoc(doc(db, "settings", "currentSemester"));
        cachedSemester = snap.exists() ? snap.data() : null;
    } catch (error) {
        console.error("خطأ في جلب الفصل الحالي:", error);
        cachedSemester = null;
    }

    return cachedSemester;
}

/**
 * يجلب أرشيف كل الفصول (semesters collection) مرتبة تنازلياً
 * برقم الفصل (الأحدث أولاً). تُستخدم في قائمة الأدمن المنسدلة.
 */
export async function getAllSemesters() {
    try {
        const snap = await getDocs(collection(db, "semesters"));
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.semester || "").localeCompare(String(a.semester || "")));
    } catch (error) {
        console.error("خطأ في جلب أرشيف الفصول:", error);
        return [];
    }
}

/**
 * تفعيل فصل جديد:
 * 1) يؤرشف الفصل الحالي (لو موجود) في semesters/{semesterId}
 * 2) يحفظ الفصل الجديد في settings/currentSemester
 * 3) يحفظ نسخة من الفصل الجديد أيضاً في semesters/{semesterId} عشان يظهر بالأرشيف فوراً
 */
export async function activateSemester({ name, semester, startDate, endDate }) {
    if (!name || !semester || !startDate || !endDate) {
        throw new Error("يرجى تعبئة جميع حقول الفصل الدراسي");
    }

    // أرشفة الفصل الحالي قبل استبداله
    const current = await getCurrentSemester(true);

    // هل هذا تفعيل لفصل جديد فعليًا (مختلف عن الفصل الحالي)، أم مجرد تحديث/تعديل
    // لبيانات نفس الفصل الحالي (نفس رقم الفصل)؟ الحذف النهائي أدناه يجب أن يحصل
    // فقط عند الانتقال الفعلي لفصل جديد، وليس عند مجرد تعديل تواريخ/اسم الفصل الحالي.
    const outgoingSemester = current?.semester;
    const isGenuinelyNewSemester = !current || String(current.semester) !== String(semester);

    if (current && current.semester) {
        await setDoc(doc(db, "semesters", String(current.semester)), {
            ...current,
            archivedAt: serverTimestamp()
        }, { merge: true });
    }

    const payload = {
        name,
        semester,
        startDate,
        endDate,
        activatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "settings", "currentSemester"), payload);
    await setDoc(doc(db, "semesters", String(semester)), payload, { merge: true });

    cachedSemester = payload;

    // =====================================================
    // ✅ حذف نهائي لطلبات الحذف/الإضافة الخاصة بالفصل المنتهي
    // =====================================================
    // بمجرد ما الأدمن يفعّل فصل جديد فعليًا، تُحذف نهائيًا من عند الطالبة كل
    // مستندات "requests" (الحذف والإضافة) المرتبطة بالفصل اللي انتهى.
    // ملاحظة: الأعذار (excuses) وطلبات الزيارة (visitRequests) لا تُحذف —
    // تبقى بسجل الطالبة كما هي. والشكاوى (complaints) لا تُحذف أبدًا بغض النظر
    // عن الفصل الدراسي.
    if (isGenuinelyNewSemester && outgoingSemester != null) {
        await deleteAddDropRequestsForSemester(outgoingSemester);
    }

    return payload;
}

/**
 * يحذف نهائيًا كل مستندات "requests" (طلبات الحذف/الإضافة فقط) المرتبطة
 * برقم فصل دراسي معيّن. تُستدعى تلقائيًا من activateSemester عند تفعيل فصل جديد.
 * الحذف مسموح للأدمن فقط حسب قواعد أمان Firestore (isAdmin() على مجموعة requests).
 */
async function deleteAddDropRequestsForSemester(semesterValue) {
    try {
        const q = query(collection(db, "requests"), where("semester", "==", semesterValue));
        const snap = await getDocs(q);

        if (snap.empty) return;

        // الحذف على دفعات (حد Firestore الأقصى 500 عملية بالدفعة الواحدة)
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 450) {
            const batch = writeBatch(db);
            docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }

        console.log(`تم حذف ${docs.length} من طلبات الحذف/الإضافة نهائيًا (الفصل: ${semesterValue})`);
    } catch (error) {
        console.error("خطأ أثناء حذف طلبات الحذف/الإضافة للفصل المنتهي:", error);
    }
}