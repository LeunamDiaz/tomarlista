"use client";
import { jsPDF } from "jspdf";
import "jspdf-autotable"; // <-- IMPORTANTE

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { db } from "./firebaseConfig";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

const ADMIN_PASSWORD = "Bienvenido614";
const ADMIN_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos

// Helper para obtener fecha local en formato YYYY-MM-DD (evita desfasajes por UTC)
function getLocalDateYMD(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const exportAttendancePDF = () => {
    if (!students || students.length === 0) {
      alert("No hay alumnos para generar el reporte.");
      return;
    }
  
    const doc = new jsPDF();
  
    const todayStrFull = new Date().toLocaleDateString("es-MX", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  
    doc.setFontSize(16);
    doc.text("Reporte de Asistencias", 14, 20);
    doc.setFontSize(12);
    doc.text(`Fecha: ${todayStrFull}`, 14, 28);
  
    // Encabezados de tabla
    const tableColumn = ["Matrícula", "Alumno", "Estado", "Hora"];
    const tableRows = [];
  
    const todayYMD = getLocalDateYMD();
  
    students.forEach(s => {
      const asistenciaHoy = s.asistencias?.find(a => a.fecha === todayYMD);
      const estado = asistenciaHoy ? "Presente" : "Ausente";
      const hora = asistenciaHoy ? asistenciaHoy.hora : "-";
  
      tableRows.push([s.matricula, s.nombre, estado, hora]);
    });
  
    // Ajuste de columnas y tabla
    let startY = 36;
    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [41, 128, 185] },
    });
  
    doc.save(`Asistencias_${todayYMD}.pdf`);
  };
  
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adminSessionTimeout, setAdminSessionTimeout] = useState(null);

  const [matriculaInput, setMatriculaInput] = useState("");
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  const [now, setNow] = useState(new Date());
  const [testRefreshEnabled, setTestRefreshEnabled] = useState(false);

  // Auto-logout admin después del timeout
  useEffect(() => {
    if (adminAuthenticated) {
      const timeout = setTimeout(() => {
        setAdminAuthenticated(false);
        setAdminOpen(false);
        setShowAdd(false);
        alert("Sesión expirada. Por favor, inicie sesión nuevamente.");
      }, ADMIN_SESSION_TIMEOUT);
      
      setAdminSessionTimeout(timeout);
      
      return () => clearTimeout(timeout);
    }
  }, [adminAuthenticated]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const refreshAttendance = async () => {
    const ok = confirm(
      "¿Desea reiniciar el estado de sesión de asistencias para TODOS los alumnos? (historial intacto)"
    );
    if (!ok) return;
  
    try {
      setSaving(true);
      setError(null);
  
      const snapshot = await getDocs(collection(db, "students"));
      const newStudents = [];
  
      for (const docSnap of snapshot.docs) {
        const studentRef = doc(db, "students", docSnap.id);
        const data = docSnap.data();
  
        const today = getLocalDateYMD();
  
        // Eliminamos asistencias de hoy solo
        const asistenciasFiltradas = (data.asistencias || []).filter(
          (a) => a.fecha !== today
        );
  
        // Actualizamos en Firebase
        await updateDoc(studentRef, {
          asistencias: asistenciasFiltradas,
          ultimaReinicializacionDePrueba: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
  
        // Actualizamos estado local
        newStudents.push({
          ...data,
          id: docSnap.id,
          asistencias: asistenciasFiltradas,
        });
      }
  
      setStudents(newStudents);
      alert(
        "✅ Asistencias reiniciadas: todos los alumnos listos para marcar nuevamente (historial intacto)."
      );
    } catch (err) {
      console.error(err);
      setError("No fue posible reiniciar las asistencias. Intente nuevamente.");
    } finally {
      setSaving(false);
    }
  };
  

  // 🔹 Cargar estudiantes desde Firebase (optimizado)
  const fetchStudents = useCallback(async () => {
    try {
      setError(null);
      console.log("Cargando estudiantes desde Firebase...");
      
      // Usar query ordenada para mejor rendimiento
      const q = query(collection(db, "students"), orderBy("nombre"));
      const querySnapshot = await getDocs(q);
      
      const list = querySnapshot.docs.map((d) => {
        const data = d.data();
        return { 
          id: d.id, 
          matricula: data.matricula || "",
          nombre: data.nombre || "",
          telefono: data.telefono || "",
          nombrePadre: data.nombrePadre || "",
          telefonoPadre: data.telefonoPadre || "",
          asistencias: data.asistencias || [],
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null
        };
      });
      
      console.log("Estudiantes cargados:", list.length, "estudiantes");
      setStudents(list);
      setLoading(false);
    } catch (error) {
      console.error("Error al cargar los estudiantes:", error);
      const errorMessage = error.code === 'permission-denied' 
        ? "Error de permisos en la base de datos. Contacte al administrador."
        : error.code === 'unavailable'
        ? "Servicio no disponible. Verifique su conexión a internet."
        : "Error al cargar datos. Intente nuevamente.";
      
      setError(errorMessage);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // 🔹 Registrar asistencia (optimizado)
  const registerAttendance = useCallback(async (matricula) => {
    if (!matricula?.trim()) {
      setError("Por favor ingrese una matrícula válida.");
      return;
    }
    
    setSaving(true);
    setError(null);
    
    try {
      console.log("Registrando asistencia para matrícula:", matricula);
      
      const matriculaTrimmed = matricula.trim();
      const student = students.find(s => s.matricula === matriculaTrimmed);
      
      if (!student) {
        setError("Matrícula no encontrada. Contacte al administrador.");
        setSaving(false);
        return;
      }

      const today = getLocalDateYMD();
      const alreadyMarked = student.asistencias?.some(a => a.fecha === today);
      
      if (alreadyMarked && !testRefreshEnabled) {
        setError("Asistencia ya registrada hoy.");
        setSaving(false);
        return;
      }

      const hora = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      
      const newAttendance = { fecha: today, hora };
      const updatedAsistencias = [...(student.asistencias || []), newAttendance];
      
      console.log("Actualizando asistencia en Firebase para:", student.id);
      await updateDoc(doc(db, "students", student.id), { 
        asistencias: updatedAsistencias,
        updatedAt: serverTimestamp()
      });
      
      // Actualizar estado local optimísticamente
      setStudents(prevStudents => 
        prevStudents.map(s => 
          s.id === student.id 
            ? { ...s, asistencias: updatedAsistencias }
            : s
        )
      );
      
      setMatriculaInput("");
      setError(null);
      
      // Mostrar mensaje de éxito
      alert(`¡Bienvenido(a), ${student.nombre}! Asistencia registrada exitosamente.`);
      
    } catch (error) {
      console.error("Error registrando asistencia:", error);
      const errorMessage = error.code === 'permission-denied' 
        ? "Error de permisos. Contacte al administrador."
        : error.code === 'unavailable'
        ? "Servicio no disponible. Verifique su conexión a internet."
        : "Error al registrar asistencia. Intente nuevamente.";
      
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  }, [students, testRefreshEnabled]);

  // 🔹 Login admin mejorado
  const handleAdminLogin = useCallback((e) => {
    e?.preventDefault();
    if (adminPasswordInput === ADMIN_PASSWORD) {
      setAdminAuthenticated(true);
      setShowAdminLogin(false);
      setAdminPasswordInput("");
      setAdminOpen(true);
      setError(null);
    } else {
      setError("Contraseña incorrecta.");
      setAdminPasswordInput("");
    }
  }, [adminPasswordInput]);

  // 🔹 Logout admin
  const handleAdminLogout = useCallback(() => {
    setAdminAuthenticated(false);
    setAdminOpen(false);
    setShowAdd(false);
    setSelected(null);
    if (adminSessionTimeout) {
      clearTimeout(adminSessionTimeout);
      setAdminSessionTimeout(null);
    }
  }, [adminSessionTimeout]);

  const handlePanelClick = useCallback(() => {
    if (!adminAuthenticated) {
      setShowAdminLogin(true);
    } else {
      setAdminOpen(prev => !prev);
    }
  }, [adminAuthenticated]);

  // 🔹 Agregar estudiante (optimizado)
  const addStudent = useCallback(async (newStudent) => {
    if (!adminAuthenticated) {
      setShowAdminLogin(true);
      return false;
    }
    
    if (!newStudent.matricula?.trim() || !newStudent.nombre?.trim()) {
      setError("Matrícula y nombre son requeridos.");
      return false;
    }

    const matriculaTrimmed = newStudent.matricula.trim();
    if (students.some(s => s.matricula === matriculaTrimmed)) {
      setError("Esa matrícula ya existe.");
      return false;
    }

    setSaving(true);
    setError(null);

    try {
      console.log("Agregando estudiante a Firebase:", newStudent);
      const studentData = {
        matricula: matriculaTrimmed,
        nombre: newStudent.nombre.trim(),
        telefono: newStudent.telefono?.trim() || "",
        nombrePadre: newStudent.nombrePadre?.trim() || "",
        telefonoPadre: newStudent.telefonoPadre?.trim() || "",
        asistencias: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const docRef = await addDoc(collection(db, "students"), studentData);
      console.log("Estudiante agregado con ID:", docRef.id);
      
      const newStudentWithId = { 
        id: docRef.id, 
        ...studentData,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      setStudents(prev => [...prev, newStudentWithId].sort((a, b) => 
        a.nombre.localeCompare(b.nombre)
      ));
      setShowAdd(false);
      setError(null);
      
      alert(`Alumno ${newStudent.nombre} agregado exitosamente.`);
      return true;
      
    } catch (error) {
      console.error("Error agregando estudiante:", error);
      const errorMessage = error.code === 'permission-denied' 
        ? "Error de permisos. Contacte al administrador."
        : error.code === 'unavailable'
        ? "Servicio no disponible. Verifique su conexión a internet."
        : "Error al agregar estudiante. Intente nuevamente.";
      
      setError(errorMessage);
      return false;
    } finally {
      setSaving(false);
    }
  }, [adminAuthenticated, students]);

  // 🔹 Eliminar estudiante (optimizado)
  const deleteStudent = useCallback(async (matricula) => {
    if (!adminAuthenticated) {
      setError("Solo los administradores pueden eliminar estudiantes.");
      return;
    }

    const student = students.find(s => s.matricula === matricula);
    if (!student) {
      setError("Estudiante no encontrado.");
      return;
    }

    const confirmDelete = confirm(
      `¿Seguro que deseas eliminar al estudiante "${student.nombre}" con matrícula ${matricula}?`
    );
    if (!confirmDelete) return;

    setSaving(true);
    setError(null);

    try {
      console.log("Eliminando estudiante de Firebase:", student.id);
      await deleteDoc(doc(db, "students", student.id));
      
      setStudents(prev => prev.filter(s => s.matricula !== matricula));
      if (selected?.matricula === matricula) setSelected(null);
      
      setError(null);
      alert("Estudiante eliminado exitosamente.");
      
    } catch (error) {
      console.error("Error al eliminar estudiante:", error);
      const errorMessage = error.code === 'permission-denied' 
        ? "Error de permisos. Contacte al administrador."
        : error.code === 'unavailable'
        ? "Servicio no disponible. Verifique su conexión a internet."
        : "Error al eliminar estudiante. Intente nuevamente.";
      
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  }, [adminAuthenticated, students, selected]);

  // 🔹 Notificar ausencia por WhatsApp (abre WhatsApp con mensaje generado)
  const notifyAbsence = useCallback((student) => {
    if (!adminAuthenticated) {
      setError("Solo los administradores pueden enviar notificaciones.");
      return;
    }

    if (!student.telefonoPadre?.trim()) {
      setError("No hay número de teléfono del padre/madre registrado.");
      return;
    }

    const today = new Date().toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const message = `Estimado padre de familia ${student.nombrePadre || ""},

Le informamos que el alumno ${student.nombre} no asistió a clases el día ${today}.

Por favor, confirme si conoce el motivo de la ausencia o si necesita más información.

Atentamente,
Sistema de Asistencia Escolar
(${getLocalDateYMD()})
`;

    // Limpiar número (solo dígitos) y asegurarse del formato internacional (+52 México)
    const phoneNumber = student.telefonoPadre
      .replace(/\D/g, "")
      .replace(/^0+/, ""); // elimina ceros iniciales

    // Construir URL para abrir WhatsApp
    const whatsappURL = `https://wa.me/52${phoneNumber}?text=${encodeURIComponent(message)}`;

    // Confirmar antes de abrir
    const confirmSend = confirm(
      `¿Desea abrir WhatsApp para notificar la ausencia de ${student.nombre} a ${student.nombrePadre || "el tutor"}?`
    );

    if (confirmSend) {
      window.open(whatsappURL, "_blank");
    }
  }, [adminAuthenticated]);

  // 🔹 Memoizar cálculos para mejor rendimiento
  const todayStr = useMemo(() => getLocalDateYMD(now), [now]);
  
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    
    const searchLower = search.toLowerCase().trim();
    return students.filter(s => 
      s.matricula.toLowerCase().includes(searchLower) ||
      s.nombre.toLowerCase().includes(searchLower) ||
      s.telefono?.toLowerCase().includes(searchLower)
    );
  }, [students, search]);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Asistencia</h1>
          <p className="text-sm text-gray-600">Gestión simple y segura</p>
          {adminAuthenticated && (
            <p className="text-xs text-green-600 mt-1">
              🔒 Sesión activa • Panel administrativo
            </p>
          )}
        </div>
        <nav className="flex gap-3">
          <button
            onClick={handlePanelClick}
            className={`px-3 py-2 border rounded-md hover:bg-gray-100 ${
              adminAuthenticated ? 'border-green-500 text-green-700' : 'border-gray-900'
            }`}
          >
            {adminAuthenticated ? '📊 Panel' : 'Panel'}
          </button>
          <button
            onClick={() => {
              if (!adminAuthenticated) return setShowAdminLogin(true);
              setShowAdd(true);
            }}
            className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-100"
            disabled={saving}
          >
            + Alumno
          </button>
          {adminAuthenticated && (
            <button
              onClick={handleAdminLogout}
              className="px-3 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
            >
              Salir
            </button>
          )}
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16">
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="text-gray-500 mt-2">Cargando datos...</p>
          </div>
        ) : (
          <>
            {/* Mostrar errores */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center">
                  <span className="text-red-500 mr-2">⚠️</span>
                  <p className="text-red-700 text-sm">{error}</p>
                  <button
                    onClick={() => setError(null)}
                    className="ml-auto text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Registrar asistencia */}
            <section className="bg-white border p-6 rounded-2xl shadow-sm">
              <h2 className="text-lg font-medium mb-3">Registrar asistencia</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  registerAttendance(matriculaInput.trim());
                }}
                className="flex gap-3 items-center"
              >
                <input
                  value={matriculaInput}
                  onChange={(e) => setMatriculaInput(e.target.value)}
                  placeholder="Ingrese su matrícula"
                  className="flex-1 border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={saving}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="px-4 py-2 border rounded-md font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={saving || !matriculaInput.trim()}
                >
                  {saving ? "Registrando..." : "Registrar"}
                </button>
              </form>
              <div className="mt-3 flex justify-between items-center text-sm text-gray-500">
                <span>
                  Hora actual: {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>
                  Total alumnos: {students.length}
                </span>
              </div>
            </section>

            {/* Panel admin */}
            {adminAuthenticated && adminOpen && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 bg-white border p-6 rounded-2xl shadow-sm"
              >
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="font-medium text-lg">Panel de administración</h3>
                    <p className="text-sm text-gray-500">
                      {filteredStudents.length} de {students.length} alumnos
                    </p>
                  </div>
                  <div>
                  <button onClick={refreshAttendance} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md shadow-md transition duration-200 ml-2">Refrescar Asistencias</button> 
                  </div>
                  <div>

                  <button
  onClick={exportAttendancePDF}
  className="px-3 py-2 border rounded-md bg-green-500 text-white hover:bg-green-600 ml-2"
  disabled={saving}
>
  📄 Exportar Asistencias (PDF)
</button>

</div>


                  <input
                    placeholder="Buscar por nombre, matrícula o teléfono..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="grid gap-3">
                  {filteredStudents.length === 0 && search ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>No se encontraron alumnos con "{search}"</p>
                      <button
                        onClick={() => setSearch("")}
                        className="text-blue-500 hover:text-blue-700 mt-2"
                      >
                        Limpiar búsqueda
                      </button>
                    </div>
                  ) : filteredStudents.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>No hay alumnos registrados.</p>
                      <button
                        onClick={() => setShowAdd(true)}
                        className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                      >
                        Agregar primer alumno
                      </button>
                    </div>
                  ) : (
                    filteredStudents.map((s) => {
                      const presenteHoy = s.asistencias?.some(
                        (a) => a.fecha === todayStr
                      );
                      const totalAsistencias = s.asistencias?.length || 0;
                      const isSelected = selected?.id === s.id;
                      return (
                        <div key={s.id}>
                          <div
                            onClick={() => setSelected(isSelected ? null : s)}
                            className={`p-4 border-2 rounded-lg cursor-pointer hover:shadow-md transition-shadow ${
                              presenteHoy ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"
                            } ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="font-medium text-lg">{s.nombre}</div>
                                <div className="text-sm text-gray-600 mt-1">
                                  📋 {s.matricula}
                                </div>
                                {s.telefono && (
                                  <div className="text-sm text-gray-600">
                                    📞 {s.telefono}
                                  </div>
                                )}
                                {s.nombrePadre && (
                                  <div className="text-sm text-gray-600">
                                    👨‍👩‍👧‍👦 {s.nombrePadre}
                                  </div>
                                )}
                                {s.telefonoPadre && (
                                  <div className="text-sm text-gray-600">
                                    📱 {s.telefonoPadre}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 mt-2">
                                  📊 {totalAsistencias} asistencias registradas
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-sm font-semibold ${
                                  presenteHoy ? "text-green-700" : "text-red-700"
                                }`}>
                                  {presenteHoy ? "✅ Presente" : "❌ Ausente"}
                                </div>
                                {presenteHoy && (
                                  <div className="text-xs text-green-600 mt-1">
                                    {s.asistencias?.find(a => a.fecha === todayStr)?.hora}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {isSelected && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="mt-3 border rounded-2xl p-4 bg-white"
                            >
                              <div className="flex justify-between items-start mb-4">
                                <div className="flex-1">
                                  <div className="font-semibold text-xl text-gray-900">{s.nombre}</div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-sm text-gray-500">Matrícula</div>
                                      <div className="font-medium">{s.matricula}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-sm text-gray-500">Teléfono</div>
                                      <div className="font-medium">{s.telefono || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-sm text-gray-500">Padre/Madre/Tutor</div>
                                      <div className="font-medium">{s.nombrePadre || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-sm text-gray-500">Teléfono del tutor</div>
                                      <div className="font-medium">{s.telefonoPadre || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg md:col-span-2">
                                      <div className="text-sm text-gray-500">Total asistencias</div>
                                      <div className="font-medium text-lg">{s.asistencias?.length || 0}</div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 ml-4">
                                  <button
                                    onClick={() => setSelected(null)}
                                    className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
                                  >
                                    Cerrar
                                  </button>
                                  {s.telefonoPadre && (
                                    <button
                                      onClick={() => notifyAbsence(s)}
                                      className="px-4 py-2 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 font-medium"
                                      disabled={saving}
                                    >
                                      {saving ? "Enviando..." : "📱 Notificar Ausencia"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => deleteStudent(s.matricula)}
                                    className="px-4 py-2 border border-red-500 rounded-md text-sm text-red-600 hover:bg-red-50 font-medium"
                                    disabled={saving}
                                  >
                                    {saving ? "Eliminando..." : "🗑️ Eliminar"}
                                  </button>
                                </div>
                              </div>

                              {/* Historial de asistencias */}
                              <div>
                                <h4 className="font-medium mb-3 text-lg">Historial de asistencias</h4>
                                <div className="max-h-60 overflow-y-auto border rounded-lg bg-white">
                                  {s.asistencias?.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500">
                                      <p>Sin registros de asistencia</p>
                                      <p className="text-sm mt-1">Las asistencias aparecerán aquí cuando el alumno se registre</p>
                                    </div>
                                  ) : (
                                    <div className="divide-y">
                                      {[...(s.asistencias || [])].reverse().map((a, i) => (
                                        <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50">
                                          <div className="flex items-center">
                                            <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                                            <span className="font-medium">{a.fecha}</span>
                                          </div>
                                          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                            {a.hora}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Panel de detalles global eliminado en favor de panel inline */}
              </motion.section>
            )}
          </>
        )}
      </main>
       
       

      {/* Modal para agregar alumno */}
      {showAdd && adminAuthenticated && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl"
          >
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-semibold">Agregar alumno</h4>
              <button
                onClick={() => setShowAdd(false)}
                className="text-gray-400 hover:text-gray-600"
                disabled={saving}
              >
                ✕
              </button>
            </div>
            <AddStudentForm
              onCancel={() => setShowAdd(false)}
              onSave={addStudent}
              isSubmitting={saving}
            />
          </motion.div>
        </motion.div>
      )}

      {/* Modal login admin */}
      {showAdminLogin && !adminAuthenticated && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl"
          >
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-semibold">Acceso administrativo</h4>
              <button
                onClick={() => setShowAdminLogin(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  placeholder="Ingrese la contraseña"
                  className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdminLogin(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 font-medium"
                >
                  Entrar
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </div> 
  );
}

function AddStudentForm({ onCancel, onSave, isSubmitting }) {
  const [matricula, setMatricula] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombrePadre, setNombrePadre] = useState("");
  const [telefonoPadre, setTelefonoPadre] = useState("");

  async function submit(e) {
    e.preventDefault();
    
    if (isSubmitting) return; // Prevenir múltiples envíos
    
    try {
      const success = await onSave({
        matricula: matricula.trim(),
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        nombrePadre: nombrePadre.trim(),
        telefonoPadre: telefonoPadre.trim(),
      });
      
      // Solo limpiar campos si el guardado fue exitoso
      if (success) {
        setMatricula("");
        setNombre("");
        setTelefono("");
        setNombrePadre("");
        setTelefonoPadre("");
      }
    } catch (error) {
      console.error("Error en el formulario:", error);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Matrícula *
        </label>
        <input
          value={matricula}
          onChange={(e) => setMatricula(e.target.value)}
          className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Ej: 2024001"
          required
          disabled={isSubmitting}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Nombre completo *
        </label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Ej: Juan Pérez"
          required
          disabled={isSubmitting}
          autoComplete="name"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Teléfono (opcional)
        </label>
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Ej: 555-1234"
          type="tel"
          disabled={isSubmitting}
          autoComplete="tel"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Nombre del padre/madre/tutor (opcional)
        </label>
        <input
          value={nombrePadre}
          onChange={(e) => setNombrePadre(e.target.value)}
          className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Ej: María García"
          disabled={isSubmitting}
          autoComplete="name"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Teléfono del padre/madre/tutor (opcional)
        </label>
        <input
          value={telefonoPadre}
          onChange={(e) => setTelefonoPadre(e.target.value)}
          className="w-full border rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Ej: 555-5678"
          type="tel"
          disabled={isSubmitting}
          autoComplete="tel"
        />
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          disabled={isSubmitting}
        >
          Cancelar
        </button>
        <button 
          type="submit" 
          className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isSubmitting || !matricula.trim() || !nombre.trim()}
        >
          {isSubmitting ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
} 