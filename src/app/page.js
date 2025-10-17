"use client";
import { jsPDF } from "jspdf";
import "jspdf-autotable"; // <-- IMPORTANTE
import { QRCodeCanvas } from "qrcode.react";
import QRCode from "qrcode"; // usamos 'qrcode' para generar dataURL del QR
// Html5Qrcode se importa dinámicamente dentro de startScanner()

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
const SCAN_DEBOUNCE_MS = 2000; // evitar lecturas repetidas rápidas

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

  const [now, setNow] = useState(null);
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
    // Inicializar la fecha solo en el cliente
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Asegurar soporte de getUserMedia (shim para navegadores antiguos) y pedir permisos al cargar
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Shim de getUserMedia para Safari/antiguos
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    if (!navigator.mediaDevices.getUserMedia) {
      const legacyGetUserMedia =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;
      if (legacyGetUserMedia) {
        navigator.mediaDevices.getUserMedia = (constraints) =>
          new Promise((resolve, reject) => legacyGetUserMedia.call(navigator, constraints, resolve, reject));
      }
    }

    // Solicitar permiso una vez al cargar para que el navegador muestre el prompt de permisos
    const requestPermission = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        // Detener inmediatamente; solo queríamos el permiso
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        // Silencioso: el usuario puede denegar; mostraremos UI luego
      }
    };

    // En contextos no seguros, getUserMedia no funciona; localhost es seguro
    const isSecure = window.isSecureContext || location.hostname === "localhost";
    if (isSecure) {
      requestPermission();
    }
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

  // QR / scanner states
  const [scannerOpen, setScannerOpen] = useState(false);
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const audioRef = React.useRef(null);
  const lastScanAtRef = React.useRef(0);
  const lastTextRef = React.useRef("");
  const detectorRef = React.useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scannerFailed, setScannerFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [qrGenerating, setQrGenerating] = useState(false);

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
        alert("No se pudo generar el QR.");
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
      const refEl = audioRef.current;
      if (refEl) {
        try {
          refEl.currentTime = 0;
          refEl.play();
          return;
        } catch (e) {}
      }
      const audio = new Audio('/assets/sonido.mp3');
      audio.play().catch(e => {
        console.warn("No se pudo reproducir el sonido:", e);
        // Fallback al beep sintético si el archivo no se puede reproducir
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

  // Función de éxito del escaneo
  const onScanSuccess = useCallback(async (decodedText) => {
    const now = Date.now();
    if (now - lastScanAtRef.current < SCAN_DEBOUNCE_MS) return;
    lastScanAtRef.current = now;

    // Reproducir sonido de beep
    playScanSound();
    
    // Registrar asistencia
    const matriculaLeida = decodedText.trim();
    await registerAttendance(matriculaLeida);
    
    // NO cerrar la cámara, mantenerla abierta para más escaneos
  }, [registerAttendance, playScanSound]);

  // Iniciar scanner de cámara - Nueva implementación con canvas y jsQR
  const startScanner = useCallback(async () => {
    if (scanning || scannerFailed) return;
    setScanning(true);
    setScannerFailed(false);

    try {
      if (typeof window === "undefined") return;

      // Verificar soporte básico de getUserMedia (tras aplicar shim en efecto de montaje)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Para usar la cámara, abra el sitio en HTTPS (o localhost) y permita acceso.");
        setScannerFailed(true);
        setScannerOpen(false);
        return;
      }

      // Preparar BarcodeDetector si está disponible; fallback a jsQR
      let jsQR = null;
      const BarcodeDetectorClass = window.BarcodeDetector;
      if (BarcodeDetectorClass && BarcodeDetectorClass.getSupportedFormats) {
        try {
          const formats = await BarcodeDetectorClass.getSupportedFormats();
          if (formats?.includes('qr_code')) {
            detectorRef.current = new BarcodeDetectorClass({ formats: ['qr_code'] });
          }
        } catch {}
      }
      if (!detectorRef.current) {
        jsQR = (await import('jsqr')).default;
      }

      // Obtener elementos del DOM
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!video || !canvas) {
        throw new Error("Elementos de video o canvas no encontrados.");
      }

      // Detener cualquier stream previo antes de crear uno nuevo
      if (video.srcObject) {
        try {
          const oldTracks = video.srcObject.getTracks?.() || [];
          oldTracks.forEach((t) => t.stop());
          video.srcObject = null;
        } catch {}
      }

      // Solicitar acceso a la cámara
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      video.srcObject = stream;
      video.setAttribute('playsinline', true); // Requerido para iOS
      // Esperar a que carguen metadatos para tener dimensiones
      await new Promise((resolve) => {
        if (video.readyState >= video.HAVE_METADATA) return resolve();
        const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
      });
      // Intentar reproducir y tolerar políticas de autoplay
      try { await video.play(); } catch (e) { /* el usuario puede necesitar interacción */ }
      setVideoReady(true);

      // Función para procesar cada frame
      let frameCount = 0;
      const tick = async () => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          // Downscale para rendimiento
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 480;
          const targetW = Math.min(1280, vw);
          const scale = targetW / vw;
          const targetH = Math.round(vh * scale);
          canvas.width = targetW;
          canvas.height = targetH;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(video, 0, 0, targetW, targetH);
          
          let text = "";
          if (detectorRef.current) {
            try {
              // Usar el elemento de video directamente (mejor desempeño en móviles)
              const codes = await detectorRef.current.detect(video);
              if (codes && codes.length > 0) {
                text = codes[0].rawValue || codes[0].rawValue;
              }
            } catch {}
          } else if (jsQR) {
            const tryDecode = () => {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
              return code?.data || "";
            };

            // 1) Intento full frame
            text = tryDecode();

            // 2) Intento región central cuadrada (mejor enfoque en móviles)
            if (!text) {
              const side = Math.min(targetW, targetH);
              const sx = Math.floor((targetW - side) / 2);
              const sy = Math.floor((targetH - side) / 2);
              const crop = ctx.getImageData(sx, sy, side, side);
              // Redibujar crop al canvas para decodificar
              canvas.width = side;
              canvas.height = side;
              ctx.putImageData(crop, 0, 0);
              text = tryDecode();
            }

            // 3) Cada 3er frame, probar rotación 90° para QR girados
            frameCount++;
            if (!text && frameCount % 3 === 0) {
              canvas.width = targetH;
              canvas.height = targetW;
              ctx.setTransform(0, 1, -1, 0, targetH, 0); // rotar 90°
              ctx.drawImage(video, 0, 0, targetW, targetH);
              text = tryDecode();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
          }

          if (text) {
            if (text !== lastTextRef.current || Date.now() - lastScanAtRef.current >= SCAN_DEBOUNCE_MS) {
              lastTextRef.current = text;
              await onScanSuccess(text);
            }
          }
          
          if (scanning) {
            requestAnimationFrame(tick);
          }
        } else {
          if (scanning) {
            requestAnimationFrame(tick);
          }
        }
      };

      // Iniciar el loop de detección
      requestAnimationFrame(tick);

      console.log("Scanner iniciado exitosamente ✅");

    } catch (err) {
      console.error("Error al iniciar scanner:", err);

      let errorMessage = "No se pudo acceder a la cámara.";
      
      if (err.message?.includes("not supported")) {
        errorMessage = "Su navegador no soporta el acceso a la cámara. Intente con Chrome, Firefox o Safari.";
      } else if (err.name === "NotAllowedError") {
        errorMessage = "Permisos de cámara denegados. Haga clic en 'Permitir' cuando aparezca el mensaje.";
      } else if (err.name === "NotFoundError") {
        errorMessage = "No se encontró ninguna cámara en este dispositivo.";
      } else if (err.name === "NotReadableError") {
        errorMessage = "La cámara está siendo usada por otra aplicación.";
      } else if (err.name === "NotSupportedError") {
        errorMessage = "Su navegador no soporta el acceso a la cámara.";
      }
      
      alert(errorMessage);
      setScannerOpen(false);
      setScannerFailed(true);
      setScanning(false);
      setVideoReady(false);
    } finally {
      // Mantener scanning=true mientras el escáner esté activo; se pondrá en false en stopScanner
    }
  }, [scanning, scannerFailed, onScanSuccess]);

  // Parar scanner
  const stopScanner = useCallback(async () => {
    try {
      const video = videoRef.current;
      if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
      }
    } catch (err) {
      console.warn("Error parando scanner:", err);
    } finally {
      setScannerOpen(false);
      setScanning(false);
      setScannerFailed(false);
      setVideoReady(false);
    }
  }, []);

  // Iniciar scanner automáticamente cuando se abre el modal
  useEffect(() => {
    if (scannerOpen && !scanning && !scannerFailed) { // No iniciar si falló
      startScanner();
    }
  }, [scannerOpen, scanning, scannerFailed, startScanner]);

  // Desbloquear audio en móviles cuando se abre el escáner (autoplay policies)
  useEffect(() => {
    if (!scannerOpen) return;
    const el = audioRef.current;
    if (!el) return;
    el.play().then(() => {
      el.pause();
      el.currentTime = 0;
    }).catch(() => {});
  }, [scannerOpen]);

  // Cerrar scanner al desmontar
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

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

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold">📚 Asistencia</h1>
            <p className="text-sm text-gray-600">Gestión simple y segura</p>
            {adminAuthenticated && (
              <p className="text-xs text-green-600 mt-1">
                🔒 Sesión activa • Panel administrativo
              </p>
            )}
          </div>
          <nav className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              onClick={handlePanelClick}
              className={`flex-1 sm:flex-none px-3 py-2 border rounded-lg hover:bg-gray-100 text-sm font-medium ${
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
              className="flex-1 sm:flex-none px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-sm font-medium"
              disabled={saving}
            >
              ➕ Alumno
            </button>
            {adminAuthenticated && (
              <button
                onClick={handleAdminLogout}
                className="flex-1 sm:flex-none px-3 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium"
              >
                🚪 Salir
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl sm:max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-6 pb-16">
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
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    registerAttendance(matriculaInput.trim());
                  }}
                  className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  disabled={saving || !matriculaInput.trim()}
                >
                  {saving ? "Registrando..." : "✅ Registrar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScannerFailed(false); // Resetear estado de fallo
                    setScannerOpen(true);
                  }}
                  className="flex-1 sm:flex-none px-6 py-3 border-2 border-green-500 text-green-600 rounded-lg hover:bg-green-50 font-semibold text-lg"
                  disabled={saving}
                >
                  📷 Escanear QR
                </button>
              </div>

              {/* Información adicional */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-sm text-gray-500 gap-2">
                <span>
                  🕐 {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                </span>
                <span>
                  👥 {students.length} alumnos registrados
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
                              className="mt-3 border rounded-2xl p-4 md:p-6 bg-white shadow-sm"
                            >
                              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                                <div className="flex-1">
                                  <div className="font-semibold text-xl md:text-2xl text-gray-900 break-words">{s.nombre}</div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mt-3">
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs md:text-sm text-gray-500">Matrícula</div>
                                      <div className="font-medium break-all">{s.matricula}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs md:text-sm text-gray-500">Teléfono</div>
                                      <div className="font-medium break-words">{s.telefono || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs md:text-sm text-gray-500">Padre/Madre/Tutor</div>
                                      <div className="font-medium break-words">{s.nombrePadre || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                      <div className="text-xs md:text-sm text-gray-500">Teléfono del tutor</div>
                                      <div className="font-medium break-words">{s.telefonoPadre || "No registrado"}</div>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg md:col-span-2">
                                      <div className="text-xs md:text-sm text-gray-500">Total asistencias</div>
                                      <div className="font-medium text-lg">{s.asistencias?.length || 0}</div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 md:gap-3 ml-0 md:ml-4">
                                  <button
                                    onClick={() => setSelected(null)}
                                    className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 whitespace-normal"
                                  >
                                    Cerrar
                                  </button>
                                  {s.telefonoPadre && (
                                    <button
                                      onClick={() => notifyAbsence(s)}
                                      className="w-full sm:w-auto px-4 py-2 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 font-medium whitespace-normal"
                                      disabled={saving}
                                    >
                                      {saving ? "Enviando..." : "📱 Notificar Ausencia"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => downloadQr(s.matricula, s.nombre)}
                                    className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 whitespace-normal"
                                    disabled={qrGenerating}
                                  >
                                    {qrGenerating ? "Generando..." : "⬇️ Descargar QR"}
                                  </button>
                                  <button
                                    onClick={() => deleteStudent(s.matricula)}
                                    className="w-full sm:w-auto px-4 py-2 border border-red-500 rounded-md text-sm text-red-600 hover:bg-red-50 font-medium whitespace-normal"
                                    disabled={saving}
                                  >
                                    {saving ? "Eliminando..." : "🗑️ Eliminar"}
                                  </button>
                                </div>
                              </div>

                              {/* Historial de asistencias */}
                              <div>
                                <h4 className="font-medium mb-3 text-lg">Historial de asistencias</h4>
                                <div className="max-h-64 md:max-h-80 overflow-y-auto border rounded-lg bg-white">
                                  {s.asistencias?.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500">
                                      <p>Sin registros de asistencia</p>
                                      <p className="text-sm mt-1">Las asistencias aparecerán aquí cuando el alumno se registre</p>
                                    </div>
                                  ) : (
                                    <div className="divide-y">
                                      {[...(s.asistencias || [])].reverse().map((a, i) => (
                                        <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50 text-sm md:text-base">
                                          <div className="flex items-center">
                                            <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                                            <span className="font-medium">{a.fecha}</span>
                                          </div>
                                          <span className="text-xs md:text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
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

      {/* Scanner QR modal */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
          <button
            onClick={() => { stopScanner(); }}
            className="absolute top-4 right-4 z-10 px-4 py-2 bg-red-600 text-white rounded-lg shadow"
          >
            ✕ Cerrar
          </button>
          <video 
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            muted
          />
        <canvas ref={canvasRef} className="hidden" />
        <audio ref={audioRef} src="/assets/sonido.mp3" preload="auto" className="hidden" />
        </div>
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
          className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 font-medium disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Guardando..." : "Guardar alumno"}
        </button>
      </div>
    </form>
  );
}