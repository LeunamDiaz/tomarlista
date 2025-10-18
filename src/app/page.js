  "use client";
  import { jsPDF } from "jspdf";
  import "jspdf-autotable"; // <-- IMPORTANTE
  import { QRCodeCanvas } from "qrcode.react";
  import QRCode from "qrcode"; // usamos 'qrcode' para generar dataURL del QR
  import { ToastContainer, toast } from "react-toastify";
  import "react-toastify/dist/ReactToastify.css";
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

  const ADMIN_PASSWORD = "Lista";
  const ADMIN_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
    
  // Helper para obtener fecha local en formato YYYY-MM-DD (evita desfasajes por UTC)
  function getLocalDateYMD(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }



export default function Home() {
  // ===== CONSTANTS =====
  // Ya no necesitamos SCAN_DEBOUNCE_MS porque usamos pausa fija de 3 segundos

  // ===== STATE HOOKS =====
  // Admin authentication state
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSessionTimeout, setAdminSessionTimeout] = useState(null);
  
  // Student management state
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  
  // Attendance registration state
  const [matriculaInput, setMatriculaInput] = useState("");
  const [error, setError] = useState(null);
  const [now, setNow] = useState(null);
  const [testRefreshEnabled, setTestRefreshEnabled] = useState(false);
  
  // QR Scanner state
  const [isScanningActive, setIsScanningActive] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrGenerating, setQrGenerating] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scanCooldownTime, setScanCooldownTime] = useState(0);

  // ===== UTILITY FUNCTIONS =====
  // Export PDF function
  const exportAttendancePDF = useCallback(() => {
    if (!adminAuthenticated) {
      setError("Solo los administradores pueden exportar reportes.");
      return;
    }

    const doc = new jsPDF();
    const today = new Date();
    const todayStrFull = today.toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
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
  }, [adminAuthenticated, students]);

  // ===== EFFECTS =====
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
      // Inicializar la fecha solo en el cliente
      setNow(new Date());
      const t = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(t);
    }, []);
  // ===== ADMIN FUNCTIONS =====
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
        toast.success(
          "✅ Asistencias reiniciadas: todos los alumnos listos para marcar nuevamente (historial intacto)."
        );
      } catch (err) {
        console.error(err);
        setError("No fue posible reiniciar las asistencias. Intente nuevamente.");
      } finally {
        setSaving(false);
      }
    };
    
  // ===== DATA MANAGEMENT FUNCTIONS =====
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

    // 🔹 Registrar asistencia (optimizado con debounce)
    const registerAttendance = useCallback(async (matricula) => {
      if (!matricula?.trim()) {
        setError("Por favor ingrese una matrícula válida.");
        return;
      }
      
      // 🛑 PREVENIR múltiples llamadas simultáneas
      if (saving) {
        console.log("Ya hay un registro en proceso, ignorando llamada duplicada");
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
          toast.error(`¡Hola, ${student.nombre}!, Tu asistencia ya fue registrada hoy.`);
          
          // Pausa de 3 segundos usando setTimeout (no bloquea la UI)
          setTimeout(() => {
            setSaving(false);
          }, 3000);
          
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
        toast.success(`¡Bienvenido(a), ${student.nombre}! Asistencia registrada exitosamente.`);

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

  // ===== AUTHENTICATION FUNCTIONS =====
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

  // ===== STUDENT MANAGEMENT FUNCTIONS =====
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
        
        toast.success(`Alumno ${newStudent.nombre} agregado exitosamente.`);
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
        toast.success("Estudiante eliminado exitosamente.");
        
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

  // ===== NOTIFICATION FUNCTIONS =====
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

  // ===== QR CODE FUNCTIONS =====
  // Generar dataURL de QR para una matrícula
    const getQrDataUrl = useCallback(async (matricula) => {
      try {
        return await QRCode.toDataURL(String(matricula), { margin: 1, width: 320 });
      } catch (err) {
        console.error("Error generando QR:", err);
        return null;
      }
    }, []);

    // Descargar el QR como PNG
    const downloadQr = useCallback(async (matricula, nombre = "") => {
      try {
        setQrGenerating(true);
        const dataUrl = await getQrDataUrl(matricula);
        if (!dataUrl) {
          toast.error("No se pudo generar el QR.");
          return;
        }
        const a = document.createElement("a");
        a.href = dataUrl;
        const safeName = (nombre || matricula).replace(/\s+/g, "_");
        a.download = `QR_${safeName}_${matricula}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        setQrGenerating(false);
      }
    }, [getQrDataUrl]);

    // Sonido de beep cuando se escanea exitosamente
    const playScanSound = useCallback(() => {
      try {
        // Usar el sonido de la carpeta public/assets
        const audio = new Audio('/assets/sonido.mp3');
        audio.volume = 0.7;
        audio.play().catch(() => {
          // Fallback: beep sintético si el archivo no se encuentra
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.type = "sine";
          o.frequency.value = 800;
          g.gain.value = 0;
          const now = ctx.currentTime;
          g.gain.linearRampToValueAtTime(0.3, now + 0.01);
          g.gain.linearRampToValueAtTime(0, now + 0.2);
          o.start(now);
          o.stop(now + 0.2);
        });
      } catch (e) {
        console.warn("Audio no disponible:", e);
      }
    }, []);

  // ===== SCANNER FUNCTIONS =====
  // Función de éxito del escaneo con pausa efectiva MEJORADA
  const onScanSuccess = useCallback(async (result) => {
    // 🛑 BLOQUEO INMEDIATO: Si ya estamos procesando un escaneo, ignorar COMPLETAMENTE
    if (isProcessingScan || !isScanningActive) {
      console.log("Escaneo ignorado - ya procesando o scanner inactivo");
      return;
    }
    
    // 🛑 MARCAR COMO PROCESANDO inmediatamente para BLOQUEAR otros escaneos
    setIsProcessingScan(true);
    setIsScanningActive(false);
    
    // 🛑 LIMPIAR el scanner inmediatamente para evitar más lecturas
    if (window.currentScanner) {
      try {
        window.currentScanner.clear();
        console.log("Scanner limpiado para evitar múltiples lecturas");
      } catch (error) {
        console.warn("Error limpiando scanner:", error);
      }
    }

    try {
      // Reproducir sonido de escáner
      playScanSound();
      
      // Mostrar resultado del escaneo
      const resultElement = document.getElementById('result');
      if (resultElement) {
        resultElement.innerHTML = `
          <h2 style="color: #4CAF50; margin-bottom: 10px;">QR Escaneado!</h2>
          <p style="font-weight: bold; word-break: break-all;">${result}</p>
        `;
      }
      
      // Procesar el registro de asistencia
      const matriculaLeida = result.trim();
      await registerAttendance(matriculaLeida);
      
    } catch (error) {
      console.error("Error procesando escaneo:", error);
    } finally {
      // PAUSA DE 3 SEGUNDOS con countdown visual MEJORADO
      setScanCooldownTime(3);
      const countdownInterval = setInterval(() => {
        setScanCooldownTime(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            // REACTIVAR el scanner después del delay
            setIsProcessingScan(false);
            setIsScanningActive(true);
            console.log("Scanner reactivado después del delay");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [isProcessingScan, isScanningActive, playScanSound, registerAttendance]);

    // Función de error del escaneo
    const onScanFailure = useCallback((error) => {
      console.warn("Error del scanner:", error);
    }, []);

    // Inicializar scanner cuando se abre el modal MEJORADO
    useEffect(() => {
      if (scannerOpen) {
        // Limpiar cualquier scanner previo antes de crear uno nuevo
        if (window.currentScanner) {
          try {
            window.currentScanner.clear();
            window.currentScanner = null;
          } catch (error) {
            console.warn("Error limpiando scanner previo:", error);
          }
        }
        
        // Importar y configurar el scanner
        const initScanner = async () => {
          try {
            const { Html5QrcodeScanner } = await import("html5-qrcode");
            
            const scanner = new Html5QrcodeScanner('reader', { 
              qrbox: {
                width: 250,
                height: 250,
              },
              fps: 10, // Reducido para mejor rendimiento
              // 👇 ESTA ES LA CLAVE para la cámara trasera
              camera: { 
                facingMode: "environment" 
              },
            });

            scanner.render(onScanSuccess, onScanFailure);
            
            // Guardar referencia del scanner para poder limpiarlo
            window.currentScanner = scanner;
            console.log("Scanner inicializado correctamente");
          } catch (error) {
            console.error("Error al cargar el scanner:", error);
            toast.error("Error al cargar el escáner QR. Intente nuevamente.");
            setScannerOpen(false);
          }
        };

        // Pequeño delay para asegurar que el DOM esté listo
        setTimeout(initScanner, 100);
      } else {
        // Limpiar scanner cuando se cierra el modal
        if (window.currentScanner) {
          try {
            window.currentScanner.clear();
            window.currentScanner = null;
            console.log("Scanner limpiado al cerrar modal");
          } catch (error) {
            console.warn("Error al limpiar scanner:", error);
          }
        }
      }
    }, [scannerOpen, onScanSuccess, onScanFailure]);

  // ===== COMPUTED VALUES =====
  // 🔹 Memoizar cálculos para mejor rendimiento
    const todayStr = useMemo(() => getLocalDateYMD(now || new Date()), [now]);
    
    const filteredStudents = useMemo(() => {
      if (!search.trim()) return students;
      
      const searchLower = search.toLowerCase().trim();
      return students.filter(s => 
        s.matricula.toLowerCase().includes(searchLower) ||
        s.nombre.toLowerCase().includes(searchLower) ||
        s.telefono?.toLowerCase().includes(searchLower)
      );
    }, [students, search]);

  // ===== RENDER =====
  return (
    <div className="min-h-screen bg-white text-gray-900">
        <header className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold">📚 Asistencia</h1>
              <p className="text-sm text-gray-600">Gestión simple y segura</p>
              {adminAuthenticated && (
                <p className="text-xs text-green-600 mt-1">
                  🔒 Sesión activa • Panel administrativo
                </p>
              )}
            </div>
            <nav className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={handlePanelClick}
                className={`flex-1 sm:flex-none px-4 py-3 border rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors ${
                  adminAuthenticated ? 'border-green-500 text-green-700 bg-green-50' : 'border-gray-900'
                }`}
              >
                {adminAuthenticated ? '📊 Panel' : '🔐 Panel'}
              </button>
              <button
                onClick={() => {
                  if (!adminAuthenticated) return setShowAdminLogin(true);
                  setShowAdd(true);
                }}
                className="flex-1 sm:flex-none px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors"
                disabled={saving}
              >
                ➕ Alumno
              </button>
              {adminAuthenticated && (
                <button
                  onClick={handleAdminLogout}
                  className="flex-1 sm:flex-none px-4 py-3 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors"
                >
                  🚪 Salir
                </button>
              )}
            </nav>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
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
              <section className="bg-white border p-4 sm:p-6 rounded-2xl shadow-sm">
                <h2 className="text-lg font-medium mb-4">Registrar asistencia</h2>
                
                {/* Input de matrícula */}
                <div className="mb-4">
                  <input
                    value={matriculaInput}
                    onChange={(e) => setMatriculaInput(e.target.value)}
                    placeholder="Ingrese su matrícula"
                    className="w-full border rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={saving}
                    autoComplete="off"
                  />
                </div>

                {/* Botones en layout responsive */}
                <div className="flex flex-col gap-3 mb-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      registerAttendance(matriculaInput.trim());
                    }}
                    className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-lg transition-colors"
                    disabled={saving || !matriculaInput.trim()}
                  >
                    {saving ? "Registrando..." : "✅ Registrar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="w-full px-6 py-3 border-2 border-green-500 text-green-600 rounded-lg hover:bg-green-50 font-semibold text-lg transition-colors"
                    disabled={saving}
                  >
                    📷 Escanear QR
                  </button>
                </div>

                {/* Información adicional */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm text-gray-500 gap-2 pt-2 border-t border-gray-100">
                  <span className="flex items-center gap-1">
                    🕐 {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                  </span>
                  <span className="flex items-center gap-1">
                    👥 {students.length} alumnos registrados
                  </span>
                </div>
              </section>
              
              <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
      />
              {/* Panel admin */}
              {adminAuthenticated && adminOpen && (
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 bg-white border p-6 rounded-2xl shadow-sm"
                >
                  <div className="mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                      <div>
                        <h3 className="font-medium text-lg">Panel de administración</h3>
                        <p className="text-sm text-gray-500">
                          {filteredStudents.length} de {students.length} alumnos
                        </p>
                      </div>
                    </div>
                    
                    {/* Botones de acción */}
                    <div className="flex flex-col sm:flex-row gap-2 mb-4">
                      <button 
                        onClick={refreshAttendance} 
                        className="flex-1 sm:flex-none bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md shadow-md transition duration-200 text-sm font-medium"
                        disabled={saving}
                      >
                        🔄 Refrescar Asistencias
                      </button> 
                      <button
                        onClick={exportAttendancePDF}
                        className="flex-1 sm:flex-none px-4 py-2 border rounded-md bg-green-500 text-white hover:bg-green-600 text-sm font-medium"
                        disabled={saving}
                      >
                        📄 Exportar PDF
                      </button>
                    </div>

                    {/* Buscador */}
                    <div className="w-full">
                      <input
                        placeholder="Buscar por nombre, matrícula o teléfono..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {filteredStudents.length === 0 && search ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>No se encontraron alumnos con &quot;{search}&quot;</p>
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
                              className={`p-4 border-2 rounded-lg cursor-pointer hover:shadow-md transition-all duration-200 ${
                                presenteHoy ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"
                              } ${isSelected ? "ring-2 ring-blue-500 shadow-lg" : ""}`}
                            >
                              <div className="flex justify-between items-start gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-lg truncate">{s.nombre}</div>
                                  <div className="text-sm text-gray-600 mt-1 truncate">
                                    📋 {s.matricula}
                                  </div>
                                  {s.telefono && (
                                    <div className="text-sm text-gray-600 truncate">
                                      📞 {s.telefono}
                                    </div>
                                  )}
                                  {s.nombrePadre && (
                                    <div className="text-sm text-gray-600 truncate">
                                      👨‍👩‍👧‍👦 {s.nombrePadre}
                                    </div>
                                  )}
                                  {s.telefonoPadre && (
                                    <div className="text-sm text-gray-600 truncate">
                                      📱 {s.telefonoPadre}
                                    </div>
                                  )}
                                  <div className="text-xs text-gray-500 mt-2">
                                    📊 {totalAsistencias} asistencias
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
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
                                {/* Header con nombre y botón cerrar */}
                                <div className="flex justify-between items-start mb-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-xl text-gray-900 truncate">{s.nombre}</div>
                                  </div>
                                  <button
                                    onClick={() => setSelected(null)}
                                    className="ml-3 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 flex-shrink-0"
                                  >
                                    ✕ Cerrar
                                  </button>
                                </div>

                                {/* Información del alumno */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <div className="text-sm text-gray-500">Matrícula</div>
                                    <div className="font-medium text-sm">{s.matricula}</div>
                                  </div>
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <div className="text-sm text-gray-500">Teléfono</div>
                                    <div className="font-medium text-sm">{s.telefono || "No registrado"}</div>
                                  </div>
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <div className="text-sm text-gray-500">Padre/Madre/Tutor</div>
                                    <div className="font-medium text-sm">{s.nombrePadre || "No registrado"}</div>
                                  </div>
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <div className="text-sm text-gray-500">Teléfono del tutor</div>
                                    <div className="font-medium text-sm">{s.telefonoPadre || "No registrado"}</div>
                                  </div>
                                  <div className="bg-gray-50 p-3 rounded-lg sm:col-span-2">
                                    <div className="text-sm text-gray-500">Total asistencias</div>
                                    <div className="font-medium text-lg">{s.asistencias?.length || 0}</div>
                                  </div>
                                </div>

                                {/* Botones de acción - diseño responsive */}
                                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                                  {s.telefonoPadre && (
                                    <button
                                      onClick={() => notifyAbsence(s)}
                                      className="flex-1 px-4 py-2 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 font-medium"
                                      disabled={saving}
                                    >
                                      {saving ? "Enviando..." : "📱 Notificar Ausencia"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => downloadQr(s.matricula, s.nombre)}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                                    disabled={qrGenerating}
                                  >
                                    {qrGenerating ? "Generando..." : "⬇️ Descargar QR"}
                                  </button>
                                  <button
                                    onClick={() => deleteStudent(s.matricula)}
                                    className="flex-1 px-4 py-2 border border-red-500 rounded-md text-sm text-red-600 hover:bg-red-50 font-medium"
                                    disabled={saving}
                                  >
                                    {saving ? "Eliminando..." : "🗑️ Eliminar"}
                                  </button>
                                </div>

                                {/* Historial de asistencias */}
                                <div>
                                  <h4 className="font-medium mb-3 text-base">Historial de asistencias</h4>
                                  <div className="max-h-48 sm:max-h-60 overflow-y-auto border rounded-lg bg-gray-50">
                                    {s.asistencias?.length === 0 ? (
                                      <div className="text-center py-6 text-gray-500 px-4">
                                        <p className="text-sm">Sin registros de asistencia</p>
                                        <p className="text-xs mt-1">Las asistencias aparecerán aquí cuando el alumno se registre</p>
                                      </div>
                                    ) : (
                                      <div className="divide-y">
                                        {[...(s.asistencias || [])].reverse().map((a, i) => (
                                          <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-100 transition-colors">
                                            <div className="flex items-center min-w-0 flex-1">
                                              <span className="w-2 h-2 bg-green-500 rounded-full mr-3 flex-shrink-0"></span>
                                              <span className="font-medium text-sm truncate">{a.fecha}</span>
                                            </div>
                                            <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border ml-2 flex-shrink-0">
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

        {/* Modal login admin - OBLIGATORIO al cargar la página */}
        {showAdminLogin && !adminAuthenticated && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl border border-gray-200"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🔒</span>
                </div>
                <h4 className="text-2xl font-bold text-gray-800 mb-2">Acceso Requerido</h4>
                <p className="text-gray-600">Ingrese la contraseña para acceder al sistema</p>
              </div>
              <form onSubmit={handleAdminLogin} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Ingrese la contraseña"
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center text-lg"
                    autoFocus
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium text-lg transition-colors"
                >
                  Acceder al Sistema
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}

          {/* Scanner QR modal */}
          {/* Scanner QR modal */}
          {scannerOpen && (
          <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
            <button
              onClick={() => setScannerOpen(false)}
              className="absolute top-4 right-4 z-10 px-4 py-2 bg-red-600 text-white rounded-lg shadow-lg hover:bg-red-700 transition-colors"
            >
              ✕ Cerrar
            </button>
            
            <div className="w-full h-full flex flex-col items-center justify-center p-4">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-bold mb-2">📷 Escáner de Código QR</h1>
                <p className="text-gray-600">Apunta la cámara al código QR del estudiante para registrar su asistencia</p>
                {isProcessingScan && (
                  <div className="mt-4 p-4 bg-orange-100 border-2 border-orange-400 rounded-lg">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600 mr-3"></div>
                      <div className="text-center">
                        <span className="text-orange-800 font-bold text-lg">
                          {scanCooldownTime > 0 
                            ? `Cargando en ${scanCooldownTime} segundos...` 
                            : '🔄 Procesando escaneo...'
                          }
                        </span>

                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <div id="reader" className="w-full max-w-2xl"></div>
              <div id="result" className="text-center text-lg mt-6 p-4 bg-gray-100 rounded-lg max-w-2xl"></div>
            </div>
          </div>
        )}
      </div> 
    );

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
            className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 font-medium disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Guardando..." : "Guardar alumno"}
          </button>
        </div>
      </form>
    );
  }
}