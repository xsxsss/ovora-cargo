import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useInView } from 'motion/react';
import { Upload, FileText, CheckCircle, XCircle, Camera, ArrowLeft, Shield, Car, CreditCard, AlertCircle, Eye, ScanLine, Zap, AlertTriangle, RefreshCw, BadgeCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTheme } from '../context/ThemeContext';
import { useUser } from '../contexts/UserContext';
import * as documentsApi from '../api/documentsApi';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { syncUserNameInChats, syncUserNameInTrips } from '../api/userApi';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';

type DocumentStatus = 'verified' | 'rejected' | 'not_uploaded' | 'pending';
type ScanIssue = 'expired' | 'expiring_soon' | 'poor_quality' | 'low_resolution' | null;
type ScanPhase = 'idle' | 'scanning' | 'done';

interface DocItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  status: DocumentStatus;
  uploadDate?: string;
  expiryDate?: string;
  hasPhoto: boolean;
  photoQualityScore: number;
  photoUrl?: string;
  rejectionReason?: string;
}

const DOC_ICONS: Record<string, React.ReactNode> = {
  passport:             <Shield className="w-4 h-4" />,
  driver_license:       <CreditCard className="w-4 h-4" />,
  vehicle_registration: <Car className="w-4 h-4" />,
  insurance:            <FileText className="w-4 h-4" />,
};

const DOCUMENT_TEMPLATES = {
  sender: [
    { id: 'passport', type: 'passport', title: 'Паспорт', subtitle: 'Удостоверение личности' },
  ],
  driver: [
    { id: 'passport', type: 'passport', title: 'Паспорт', subtitle: 'Удостоверение личности' },
    { id: 'driver_license', type: 'driver_license', title: 'Водительские права', subtitle: 'Разрешение на вождение' },
    { id: 'vehicle_registration', type: 'vehicle_registration', title: 'ТехПаспорт', subtitle: 'Регистрация транспортного средства' },
    { id: 'insurance', type: 'insurance', title: 'Страховка', subtitle: 'ОСАГО / страховой полис' },
  ],
};

// ── Scroll-reveal wrapper ──────────────────────────────────────────────────────
function RevealCard({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.38, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ── Scanline overlay (document scan animation) ────────────────────────────────
function ScanlineOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-blue-500/5" />
          <motion.div
            className="absolute left-0 right-0 h-[2px]"
            style={{ background: 'linear-gradient(90deg, transparent, #2693ff, #00e5ff, #2693ff, transparent)' }}
            initial={{ top: '0%' }}
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Issue banner (flat left-accent style) ─────────────────────────────────────
function IssueBanner({ issue, isDark }: { issue: ScanIssue; isDark: boolean }) {
  if (!issue) return null;
  const cfg: Record<NonNullable<ScanIssue>, { leftColor: string; icon: React.ReactNode; text: string; textColor: string }> = {
    expired: {
      leftColor: 'border-l-red-500',
      icon: <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
      text: 'Срок действия документа истёк. Обновите документ.',
      textColor: isDark ? 'text-red-300' : 'text-red-700',
    },
    expiring_soon: {
      leftColor: 'border-l-amber-400',
      icon: <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
      text: 'Документ скоро истекает. Рекомендуется обновить.',
      textColor: isDark ? 'text-amber-300' : 'text-amber-700',
    },
    poor_quality: {
      leftColor: 'border-l-orange-400',
      icon: <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
      text: 'Низкое качество фото — текст плохо читаем. Загрузите чёткое изображение.',
      textColor: isDark ? 'text-orange-300' : 'text-orange-700',
    },
    low_resolution: {
      leftColor: 'border-l-orange-400',
      icon: <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
      text: 'Разрешение фото слишком низкое. Сделайте более чёткое фото.',
      textColor: isDark ? 'text-orange-300' : 'text-orange-700',
    },
  };
  const c = cfg[issue];
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.3 }}
      className={`flex gap-2 pl-3 py-2 border-l-2 text-[11.5px] font-medium leading-relaxed ${c.leftColor} ${c.textColor}`}
    >
      {c.icon}
      {c.text}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function DocumentVerificationPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user: currentUser, refreshUser } = useUser();
  const userRole = (sessionStorage.getItem('userRole') || 'sender') as 'driver' | 'sender';

  const TODAY = new Date();

  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // ── Upload modal state ─────────────────────────────────────────────────────
  const [uploadModal, setUploadModal] = useState<{
    open: boolean;
    doc: DocItem | null;
    file: File | null;
  }>({ open: false, doc: null, file: null });
  const [modalFullName, setModalFullName] = useState('');
  const [modalExpiry, setModalExpiry] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // ── OCR pre-scan state ─────────────────────────────────────────────────────
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrResult, setOcrResult] = useState<{
    fullName: string | null;
    birthDate: string | null;
    detectedType: string | null;
  } | null>(null);

  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanningIndex, setScanningIndex] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, ScanIssue>>({});
  const [showResults, setShowResults] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Load documents from database ───────────────────────────────────────────
  async function loadDocuments() {
    if (!currentUser?.email) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const dbDocs = await documentsApi.getUserDocuments(currentUser.email);
      const templates = DOCUMENT_TEMPLATES[userRole] || DOCUMENT_TEMPLATES.sender;
      const mergedDocs: DocItem[] = templates.map(template => {
        const dbDoc = dbDocs.find(d => d.id === template.id);
        if (dbDoc) {
          return {
            id: dbDoc.id, type: dbDoc.type, title: dbDoc.title, subtitle: dbDoc.subtitle,
            status: dbDoc.status as DocumentStatus,
            uploadDate: dbDoc.uploadDate ? new Date(dbDoc.uploadDate).toLocaleDateString('ru-RU', {
              day: 'numeric', month: 'long', year: 'numeric'
            }) : undefined,
            expiryDate: dbDoc.expiryDate || undefined,
            hasPhoto: !!dbDoc.photoUrl,
            photoQualityScore: dbDoc.photoQualityScore || 0,
            photoUrl: dbDoc.photoUrl,
            rejectionReason: dbDoc.rejectionReason,
          };
        }
        return {
          id: template.id, type: template.type, title: template.title,
          subtitle: template.subtitle, status: 'not_uploaded' as DocumentStatus,
          hasPhoto: false, photoQualityScore: 0,
        };
      });
      setDocuments(mergedDocs);
    } catch {
      const templates = DOCUMENT_TEMPLATES[userRole] || DOCUMENT_TEMPLATES.sender;
      const fallbackDocs: DocItem[] = templates.map(template => ({
        id: template.id, type: template.type, title: template.title,
        subtitle: template.subtitle, status: 'not_uploaded' as DocumentStatus,
        hasPhoto: false, photoQualityScore: 0,
      }));
      setDocuments(fallbackDocs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email, userRole]);

  // ── Auto-detect issues ─────────────────────────────────────────────────────
  function detectIssue(doc: DocItem): ScanIssue {
    if (!doc.hasPhoto || doc.status === 'not_uploaded') return null;
    if (doc.expiryDate) {
      const exp = new Date(doc.expiryDate);
      const daysLeft = Math.floor((exp.getTime() - TODAY.getTime()) / 86400000);
      if (daysLeft < 0) return 'expired';
      if (daysLeft <= 30) return 'expiring_soon';
    }
    if (doc.photoQualityScore < 50) return 'low_resolution';
    if (doc.photoQualityScore < 70) return 'poor_quality';
    return null;
  }

  // ── Run scan sequence ──────────────────────────────────────────────────────
  async function runScan() {
    if (scanPhase === 'scanning') return;
    setScanPhase('scanning');
    setShowResults(false);
    setIssues({});
    setScanProgress(0);
    const detectedIssues: Record<string, ScanIssue> = {};
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      setScanningIndex(doc.id);
      setScanProgress(Math.round(((i) / documents.length) * 100));
      await new Promise(r => setTimeout(r, 900 + Math.random() * 400));
      detectedIssues[doc.id] = detectIssue(doc);
    }
    setScanningIndex(null);
    setScanProgress(100);
    setIssues(detectedIssues);
    setScanPhase('done');
    setShowResults(true);
  }

  useEffect(() => {
    if (!loading && documents.length > 0 && scanPhase === 'idle') {
      const t = setTimeout(runScan, 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, documents.length, scanPhase]);

  // ── OCR compression utilities ──────────────────────────────────────────────
  async function compressForOcr(file: File): Promise<File> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          const MAX_SIDE = 1800;
          if (width > height && width > MAX_SIDE) {
            height = Math.round((height * MAX_SIDE) / width); width = MAX_SIDE;
          } else if (height >= width && height > MAX_SIDE) {
            width = Math.round((width * MAX_SIDE) / height); height = MAX_SIDE;
          }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          let quality = 0.88;
          const TARGET_KB = 500;
          const tryEncode = () => {
            canvas.toBlob((blob) => {
              if (!blob) { resolve(file); return; }
              if (blob.size / 1024 <= TARGET_KB || quality <= 0.55) {
                resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg', lastModified: Date.now() }));
              } else { quality -= 0.08; tryEncode(); }
            }, 'image/jpeg', quality);
          };
          tryEncode();
        };
        img.onerror = () => resolve(file);
      };
      reader.onerror = () => resolve(file);
    });
  }

  async function compressImage(file: File, maxSizeKB: number = 700): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width, height = img.height;
          const MAX_WIDTH = 1920, MAX_HEIGHT = 1920;
          if (width > height) { if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width = Math.round((width * MAX_HEIGHT) / height); height = MAX_HEIGHT; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Failed to get canvas context')); return; }
          ctx.drawImage(img, 0, 0, width, height);
          let quality = 0.9;
          const tryCompress = () => {
            canvas.toBlob((blob) => {
              if (!blob) { reject(new Error('Failed to compress image')); return; }
              if (blob.size / 1024 <= maxSizeKB || quality <= 0.3) {
                resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
              } else { quality -= 0.1; tryCompress(); }
            }, 'image/jpeg', quality);
          };
          tryCompress();
        };
        img.onerror = () => reject(new Error('Failed to load image'));
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
    });
  }

  // ── OCR pre-scan ───────────────────────────────────────────────────────────
  async function runOcrPrescan(file: File, docType: string) {
    setOcrScanning(true);
    setOcrResult(null);
    try {
      const ocrFile = await compressForOcr(file);
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => { resolve((e.target?.result as string).split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(ocrFile);
      });
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a/ocr/scan-document`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN },
          body: JSON.stringify({ imageBase64: base64, documentType: docType }),
        }
      );
      const data = await response.json();
      if (data.success) {
        const ocrRes = { fullName: data.fullName || null, birthDate: data.birthDate || null, detectedType: data.detectedType || null };
        setOcrResult(ocrRes);
        if (data.fullName) setModalFullName(data.fullName);
      } else {
        setOcrResult({ fullName: null, birthDate: null, detectedType: null });
      }
    } catch {
      setOcrResult({ fullName: null, birthDate: null, detectedType: null });
    } finally {
      setOcrScanning(false);
    }
  }

  // ── Handle file select ─────────────────────────────────────────────────────
  function handleFileSelect(doc: DocItem, file: File) {
    if (!currentUser?.email) { toast.error('Ошибка', { description: 'Пользователь не авторизован' }); return; }
    setModalFullName('');
    setModalExpiry('');
    setOcrResult(null);
    setUploadModal({ open: true, doc, file });
    runOcrPrescan(file, doc.type);
  }

  // ── Upload after modal confirm ─────────────────────────────────────────────
  const handleModalUpload = useCallback(async () => {
    const { doc, file } = uploadModal;
    if (!doc || !file || !currentUser?.email) return;
    if (doc.type !== 'passport' && !modalFullName.trim()) {
      toast.error('Введите ФИО', { description: 'ФИО обязательно для проверки соответствия с паспортом' });
      return;
    }
    setModalSubmitting(true);
    setUploading(true);
    try {
      let fileToUpload = file;
      if (file.size / 1024 > 700) {
        toast.info('📦 Сжимаем изображение...', { description: `Размер: ${(file.size/1024).toFixed(0)} KB.`, duration: 2000 });
        try {
          fileToUpload = await compressImage(file);
        } catch {
          toast.error('Ошибка сжатия', { description: 'Попробуйте выбрать файл меньшего размера' });
          setModalSubmitting(false); setUploading(false); return;
        }
      }
      const extractedFullName = modalFullName.trim() || undefined;
      const expiryDate = modalExpiry.trim() || undefined;
      const uploadedDoc = await documentsApi.uploadDocument({
        file: fileToUpload, userEmail: currentUser.email,
        documentId: doc.id, documentType: doc.type,
        title: doc.title, subtitle: doc.subtitle, expiryDate, extractedFullName,
      });
      setUploadModal({ open: false, doc: null, file: null });
      setOcrResult(null);
      if ((uploadedDoc as any).error === 'document_type_mismatch') {
        toast.error('Неверный тип документа', {
          description: `Ожидался: ${(uploadedDoc as any).expectedType}, обнаружен: ${(uploadedDoc as any).detectedType}.`,
          duration: 7000,
        });
        await loadDocuments(); return;
      }
      if (uploadedDoc.profileUpdated && uploadedDoc.updatedUser) {
        await refreshUser();
        const updatedFields: string[] = [];
        if (uploadedDoc.updatedUser.fullName) updatedFields.push(`ФИО: ${uploadedDoc.updatedUser.fullName}`);
        if (currentUser?.email && uploadedDoc.updatedUser) {
          const { firstName, lastName, middleName, fullName, avatarUrl } = uploadedDoc.updatedUser;
          const syncData = { firstName, lastName, middleName, fullName, avatarUrl };
          syncUserNameInChats(currentUser.email, syncData).catch(() => {});
          syncUserNameInTrips(currentUser.email, syncData).catch(() => {});
        }
        toast.success('✅ Паспорт одобрен! Профиль обновлён', {
          description: updatedFields.join(' • ') || 'Данные из паспорта сохранены в профиле',
          duration: 8000, icon: '👤',
        });
      } else if (doc.type === 'passport' && uploadedDoc.status === 'verified') {
        toast.success('✅ Паспорт одобрен!', {
          description: extractedFullName ? `ФИО "${extractedFullName}" сохранено в профиле` : 'Документ прошёл проверку.',
          duration: 5000,
        });
        if (extractedFullName) await refreshUser();
      } else if (uploadedDoc.status === 'verified') {
        toast.success(`✅ ${doc.title} одобрен!`, { description: 'Документ успешно прошёл проверку.', duration: 4000 });
      } else if (uploadedDoc.status === 'rejected') {
        toast.error(`❌ ${doc.title} отклонён`, {
          description: uploadedDoc.rejectionReason || 'Документ не прошёл проверку.',
          duration: 7000,
        });
      } else if (uploadedDoc.status === 'pending') {
        toast(`📋 ${doc.title} отправлен на проверку`, {
          description: 'Администратор проверит документ вручную.',
          duration: 5000,
        });
      }
      await loadDocuments();
      setTimeout(() => { setScanPhase('idle'); runScan(); }, 500);
    } catch (error) {
      toast.error('Ошибка загрузки', { description: (error as Error).message });
    } finally {
      setModalSubmitting(false); setUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadModal, modalFullName, modalExpiry, currentUser?.email, ocrScanning]);

  // ── Computed values ────────────────────────────────────────────────────────
  const verifiedCount = documents.filter(d => d.status === 'verified').length;
  const totalRequired = documents.length;
  const progressPct = totalRequired > 0 ? (verifiedCount / totalRequired) * 100 : 0;
  const issueCount = Object.values(issues).filter(Boolean).length;

  // ── Theme tokens (flat Telegram style) ────────────────────────────────────
  const _bg          = isDark ? '_bg-[#060e1a]'   : '_bg-white';
  const _header      = isDark ? 'bg-[#060e1a]/95 border-[#1e2d3d]' : 'bg-white/95 border-[#e8eaed]';
  const textPrimary = isDark ? 'text-white'      : 'text-[#0f172a]';
  const textSec     = isDark ? 'text-[#6b7f94]'  : 'text-[#94a3b8]';
  const textMuted   = isDark ? 'text-[#3d5263]'  : 'text-[#cbd5e1]';
  const divider     = isDark ? 'border-[#1e2d3d]' : 'border-[#f0f2f5]';

  const statusConfig = {
    verified: {
      label: 'Одобрен',
      badge: isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-700',
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      iconColor: isDark ? 'text-emerald-400' : 'text-emerald-600',
    },
    rejected: {
      label: 'Отклонен',
      badge: isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-700',
      icon: <XCircle className="w-3.5 h-3.5" />,
      iconColor: isDark ? 'text-red-400' : 'text-red-600',
    },
    pending: {
      label: 'На проверке',
      badge: isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-700',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      iconColor: isDark ? 'text-amber-400' : 'text-amber-600',
    },
    not_uploaded: {
      label: 'Не загружено',
      badge: isDark ? 'bg-[#1e2d3d] text-[#6b7f94]' : 'bg-slate-100 text-slate-500',
      icon: <Upload className="w-3.5 h-3.5" />,
      iconColor: isDark ? 'text-[#4a6578]' : 'text-slate-400',
    },
  };

  function qualityColor(score: number) {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-400';
    return 'bg-red-500';
  }
  function qualityLabel(score: number) {
    if (score >= 80) return 'Отличное';
    if (score >= 60) return 'Среднее';
    return 'Плохое';
  }
  function daysLeft(dateStr: string) {
    return Math.floor((new Date(dateStr).getTime() - TODAY.getTime()) / 86400000);
  }

  const modalExpiryDisplay: string | null = (() => {
    if (!modalExpiry) return null;
    const parts = modalExpiry.split('-');
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const d = new Date(modalExpiry);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return null;
  })();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-['Sora'] bg-[#060e1a]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#6b7f94]">Загрузка документов…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="font-['Sora'] bg-[#060e1a] text-white">

      {/* ══════════════════════ MOBILE (unchanged) ══════════════════════════ */}
      <div className="md:hidden min-h-screen flex flex-col max-w-2xl mx-auto">

      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-md px-4 py-3 flex items-center gap-3 border-b bg-[#060e1a]/95 border-[#1e2d3d]">
        <button onClick={() => navigate('/profile')} className="w-8 h-8 flex items-center justify-center transition-colors text-[#8a9bb0] hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[16px] font-bold flex-1">Документы</h1>
        <button onClick={runScan} disabled={scanPhase === 'scanning'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold transition-all ${scanPhase === 'scanning' ? 'text-blue-400' : 'text-[#1978e5]'}`}>
          {scanPhase === 'scanning'
            ? <><ScanLine className="w-3.5 h-3.5 animate-pulse" /> Сканирование…</>
            : <><RefreshCw className="w-3.5 h-3.5" /> Сканировать</>}
        </button>
      </header>

      <main className="flex-1 pb-10">

        {/* ── Scan status banner ─────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {scanPhase === 'scanning' && (
            <motion.div key="scanning" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="px-4 py-3 border-b border-[#1e2d3d]">
              <div className="flex items-center gap-3 mb-2">
                <ScanLine className="w-4 h-4 animate-pulse text-blue-400" />
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-white">Автоматическое сканирование</p>
                  <p className="text-[11px] text-[#6b7f94]">Проверка срока действия и качества фото…</p>
                </div>
                <span className="text-[12px] font-bold text-blue-400">{scanProgress}%</span>
              </div>
              <div className="h-[2px] rounded-full overflow-hidden bg-[#1e2d3d]">
                <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg,#2693ff,#00e5ff)' }} animate={{ width: `${scanProgress}%` }} transition={{ duration: 0.4 }} />
              </div>
            </motion.div>
          )}
          {scanPhase === 'done' && showResults && (
            <motion.div key="done" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-4 py-3 border-b border-[#1e2d3d] flex items-center gap-3">
              {issueCount === 0 ? <BadgeCheck className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-orange-400" />}
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-white">{issueCount === 0 ? 'Все документы в порядке' : `Обнаружено проблем: ${issueCount}`}</p>
                <p className="text-[11px] text-[#6b7f94]">{issueCount === 0 ? 'Проверка срока действия и качества фото пройдена' : 'Прокрутите вниз — проблемные документы отмечены'}</p>
              </div>
              {issueCount > 0 && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black bg-orange-500/20 text-orange-400">{issueCount}</span>}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Progress section ───────────────────────────────────────────── */}
        <RevealCard delay={0.04}>
          <div className="px-4 py-4 border-b border-[#1e2d3d]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-1 text-[#6b7f94]">Прогресс верификации</p>
                <p className="text-[20px] font-black text-white">{verifiedCount}<span className="text-[13px] font-medium ml-1 text-[#6b7f94]">/ {totalRequired} документов</span></p>
              </div>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${verifiedCount === totalRequired ? 'border-emerald-500/40' : 'border-[#1e2d3d]'}`}>
                <span className={`text-[13px] font-black ${verifiedCount === totalRequired ? 'text-emerald-400' : 'text-[#6b7f94]'}`}>{Math.round(progressPct)}%</span>
              </div>
            </div>
            <div className="h-[3px] rounded-full overflow-hidden bg-[#1e2d3d]">
              <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{ background: progressPct === 100 ? 'linear-gradient(90deg,#10b981,#059669)' : 'linear-gradient(90deg,#2693ff,#1978e5)' }} />
            </div>
            <div className="flex gap-0 mt-3 border-t pt-3 border-[#1e2d3d]">
              {[
                { label: 'Одобрено',     count: documents.filter(d => d.status === 'verified').length,     color: 'text-emerald-400' },
                { label: 'Отклонено',    count: documents.filter(d => d.status === 'rejected').length,     color: 'text-red-400' },
                { label: 'Не загружено', count: documents.filter(d => d.status === 'not_uploaded').length, color: 'text-[#6b7f94]' },
              ].map((pill, i) => (
                <div key={pill.label} className={`flex-1 text-center ${i < 2 ? 'border-r border-[#1e2d3d]' : ''}`}>
                  <p className={`text-[16px] font-black ${pill.color}`}>{pill.count}</p>
                  <p className="text-[10px] font-medium text-[#3d5263]">{pill.label}</p>
                </div>
              ))}
            </div>
          </div>
        </RevealCard>

        {/* ── Document type instruction ──────────────────────────────────── */}
        <RevealCard delay={0.06}>
          <div className="px-4 py-4 border-b border-[#1e2d3d]">
            <div className="flex gap-2 mb-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-400" />
              <p className="text-[13px] font-semibold text-blue-400">Загружайте правильные документы</p>
            </div>
            <div className="space-y-1.5 text-[11.5px] text-[#6b7f94] pl-6">
              <div className="flex items-center gap-2"><span>🪪</span><span><span className="font-semibold text-white">Паспорт</span> → в раздел «Паспорт»</span></div>
              <div className="flex items-center gap-2"><span>🚗</span><span><span className="font-semibold text-white">Водительское удостоверение</span> → в раздел «ВУ»</span></div>
              <div className="flex items-center gap-2"><span>📋</span><span><span className="font-semibold text-white">Техпаспорт</span> → в раздел «ТехПаспорт»</span></div>
            </div>
            <p className="text-[10.5px] mt-2 pl-6 text-[#3d5263]">Несоответствие типа документа → автоматический отказ с причиной.</p>
          </div>
        </RevealCard>

        {/* ── Documents list ─────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-3 text-[#6b7f94]">Список документов</p>
          {documents.map((doc, idx) => {
            const cfg = statusConfig[doc.status] || statusConfig['not_uploaded'];
            const issue = issues[doc.id] ?? null;
            const isScanning = scanningIndex === doc.id;
            const dl = doc.expiryDate ? daysLeft(doc.expiryDate) : null;
            return (
              <RevealCard key={doc.id} delay={0.07 + idx * 0.05}>
                <div className={`relative border-b border-[#1e2d3d] ${issue ? 'border-l-2 border-l-orange-500/50' : ''}`}>
                  <ScanlineOverlay active={isScanning} />
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${cfg.iconColor}`}>{DOC_ICONS[doc.type]}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[14px] text-white">{doc.title}</p>
                      <p className="text-[11px] text-[#6b7f94] truncate">{doc.subtitle}</p>
                    </div>
                    <span className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold whitespace-nowrap ${cfg.badge}`}>{cfg.icon}{cfg.label}</span>
                  </div>
                  <AnimatePresence>
                    {isScanning && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2 border-l-2 border-l-blue-400 text-blue-400">
                          <Zap className="w-3.5 h-3.5 animate-pulse" /><span className="text-[11px] font-semibold">Анализирую документ…</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {doc.hasPhoto && doc.status !== 'not_uploaded' && !isScanning && (
                    <div className="mx-4 mb-3 pt-2 border-t border-[#1e2d3d] space-y-2">
                      <div className="flex gap-6">
                        {doc.uploadDate && <div><p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 text-[#3d5263]">Загружено</p><p className="text-[11.5px] font-medium text-[#6b7f94]">{doc.uploadDate}</p></div>}
                        {doc.expiryDate && <div><p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 text-[#3d5263]">Действителен до</p>
                          <p className={`text-[11.5px] font-semibold ${dl !== null && dl < 0 ? 'text-red-400' : dl !== null && dl <= 30 ? 'text-amber-400' : 'text-[#6b7f94]'}`}>
                            {new Date(doc.expiryDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {dl !== null && dl < 0 && <span className="ml-1 text-[10px]">(истёк)</span>}
                            {dl !== null && dl >= 0 && dl <= 30 && <span className="ml-1 text-[10px]">({dl} д.)</span>}
                          </p>
                        </div>}
                      </div>
                      {showResults && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#3d5263]">Качество фото</p>
                            <p className={`text-[11px] font-semibold ${doc.photoQualityScore >= 80 ? 'text-emerald-400' : doc.photoQualityScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{qualityLabel(doc.photoQualityScore)} · {doc.photoQualityScore}%</p>
                          </div>
                          <div className="h-[2px] rounded-full overflow-hidden bg-[#1e2d3d]">
                            <motion.div className={`h-full rounded-full ${qualityColor(doc.photoQualityScore)}`} initial={{ width: 0 }} animate={{ width: `${doc.photoQualityScore}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}
                  {showResults && issue && <div className="mx-4 mb-3"><IssueBanner issue={issue} isDark={true} /></div>}
                  {doc.status === 'rejected' && doc.rejectionReason && (
                    <div className="mx-4 mb-3">
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}
                        className={`flex gap-2 pl-3 py-2 border-l-2 text-[11.5px] font-medium leading-relaxed ${doc.rejectionReason.includes('Неверный тип документа') || doc.rejectionReason.includes('не совпадает') ? 'border-l-orange-400 text-orange-300' : 'border-l-red-500 text-red-300'}`}>
                        {doc.rejectionReason.includes('Неверный тип документа') ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1"><p className="font-semibold mb-1">{doc.rejectionReason.includes('Неверный тип документа') ? '⚠️ Неправильный документ!' : 'Причина отказа:'}</p><p className="leading-relaxed">{doc.rejectionReason}</p></div>
                      </motion.div>
                    </div>
                  )}
                  {doc.status === 'not_uploaded' && (
                    <div className="px-4 pb-3">
                      <input ref={(el) => { fileInputRefs.current[doc.id] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(doc, f); }} />
                      <button onClick={() => fileInputRefs.current[doc.id]?.click()} disabled={uploading} className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-bold text-[#1978e5] transition-all active:opacity-70 disabled:opacity-50">
                        <Camera className="w-4 h-4" />{uploading ? 'Загрузка...' : 'Загрузить документ'}
                      </button>
                    </div>
                  )}
                  {doc.status === 'rejected' && (
                    <div className="px-4 pb-3">
                      <input ref={(el) => { fileInputRefs.current[doc.id] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(doc, f); }} />
                      <button onClick={() => fileInputRefs.current[doc.id]?.click()} disabled={uploading} className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-bold text-[#1978e5] transition-all active:opacity-70 disabled:opacity-50">
                        <Upload className="w-4 h-4" />{uploading ? 'Загрузка...' : 'Загрузить заново'}
                      </button>
                    </div>
                  )}
                  {doc.status === 'verified' && (
                    <div className="px-4 pb-3 flex gap-4">
                      <button onClick={() => { if (doc.photoUrl) window.open(doc.photoUrl, '_blank'); }} className="flex items-center gap-1.5 py-2 text-[12px] font-semibold transition-all active:opacity-70 text-[#6b7f94]">
                        <Eye className="w-3.5 h-3.5" />Просмотреть
                      </button>
                      <input ref={(el) => { fileInputRefs.current[doc.id] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(doc, f); }} />
                      <button onClick={() => fileInputRefs.current[doc.id]?.click()} disabled={uploading} className="flex items-center gap-1.5 py-2 text-[12px] font-bold text-[#1978e5] transition-all active:opacity-70 disabled:opacity-50">
                        <Upload className="w-3.5 h-3.5" />{uploading ? 'Загрузка...' : 'Обновить'}
                      </button>
                    </div>
                  )}
                </div>
              </RevealCard>
            );
          })}
        </div>

        {/* ── Requirements ───────────────────────────────────────────────── */}
        <RevealCard delay={0.3}>
          <div className="px-4 py-4 border-b border-[#1e2d3d]">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-blue-400" />
              <p className="text-[13px] font-semibold text-white">Требования к документам</p>
            </div>
            <div className="space-y-2 pl-6">
              {['Фото должно быть чётким и читаемым (качество ≥ 70%)','Документ должен быть действительным — не просрочен','Все данные должны быть полностью видны','Форматы: JPG, PNG — до 5 МБ'].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full mt-2 flex-shrink-0 bg-[#3d5263]" />
                  <p className="text-[12px] leading-relaxed text-[#6b7f94]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </RevealCard>

      </main>
      </div>{/* end md:hidden */}

      {/* ══════════════════════ DESKTOP ═════════════════════════════════════ */}
      <div className="hidden md:block min-h-screen">

        {/* Top bar */}
        <div className="border-b border-white/[0.06]" style={{ background: '#060e1a' }}>
          <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a6278]">Верификация</p>
              <h1 className="text-[22px] font-black text-white leading-tight">Документы</h1>
            </div>
            <div className="flex items-center gap-3">
              <AnimatePresence mode="wait">
                {scanPhase === 'scanning' && (
                  <motion.div key="sp" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-bold text-blue-400"
                    style={{ background: '#2693ff14', borderWidth: 1, borderStyle: 'solid', borderColor: '#2693ff25' }}>
                    <ScanLine className="w-3.5 h-3.5 animate-pulse" /> Сканирование… {scanProgress}%
                  </motion.div>
                )}
                {scanPhase === 'done' && showResults && (
                  <motion.div key="dp" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-bold ${issueCount === 0 ? 'text-emerald-400' : 'text-orange-400'}`}
                    style={{ background: issueCount === 0 ? '#10b98114' : '#f9731614', borderWidth: 1, borderStyle: 'solid', borderColor: issueCount === 0 ? '#10b98125' : '#f9731625' }}>
                    {issueCount === 0 ? <BadgeCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {issueCount === 0 ? 'Все в порядке' : `${issueCount} проблем`}
                  </motion.div>
                )}
              </AnimatePresence>
              <button onClick={runScan} disabled={scanPhase === 'scanning'}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-[#607080] hover:text-white transition-all disabled:opacity-50"
                style={{ background: '#ffffff08', borderWidth: 1, borderStyle: 'solid', borderColor: '#ffffff10' }}>
                <RefreshCw className={`w-4 h-4 ${scanPhase === 'scanning' ? 'animate-spin' : ''}`} /> Сканировать
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-8 py-8 flex gap-8 items-start">

          {/* LEFT sidebar */}
          <div className="w-72 flex-shrink-0 flex flex-col gap-4 sticky top-8">

            {/* Progress card */}
            <div className="rounded-3xl overflow-hidden"
              style={{ background: 'linear-gradient(145deg,#0d1f3a,#111827)', borderWidth: 1, borderStyle: 'solid', borderColor: '#ffffff0d' }}>
              <div className="h-1" style={{ background: `linear-gradient(90deg,${progressPct === 100 ? '#10b981' : '#2693ff'},${progressPct === 100 ? '#05966980' : '#2693ff80'},transparent)` }} />
              <div className="p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#4a6278] mb-4">Прогресс верификации</p>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-16 h-16 flex-shrink-0">
                    <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                      <circle cx="28" cy="28" r="22" fill="none" stroke="#1e2d3d" strokeWidth="4" />
                      <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4"
                        stroke={progressPct === 100 ? '#10b981' : '#2693ff'} strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 22}`}
                        strokeDashoffset={`${2 * Math.PI * 22 * (1 - progressPct / 100)}`}
                        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-[13px] font-black ${progressPct === 100 ? 'text-emerald-400' : 'text-white'}`}>{Math.round(progressPct)}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[28px] font-black text-white leading-none">{verifiedCount}</p>
                    <p className="text-[12px] text-[#6b7f94] mt-0.5">из {totalRequired} документов</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden bg-[#1e2d3d] mb-4">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${progressPct}%`, background: progressPct === 100 ? 'linear-gradient(90deg,#10b981,#059669)' : 'linear-gradient(90deg,#2693ff,#1978e5)' }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Одобрено',  count: documents.filter(d => d.status === 'verified').length,     color: '#10b981' },
                    { label: 'Отклонено', count: documents.filter(d => d.status === 'rejected').length,     color: '#ef4444' },
                    { label: 'Ожидается', count: documents.filter(d => d.status === 'not_uploaded').length, color: '#6b7f94' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-2.5 text-center" style={{ background: s.color + '0e', borderWidth: 1, borderStyle: 'solid', borderColor: s.color + '20' }}>
                      <p className="text-[18px] font-black" style={{ color: s.color }}>{s.count}</p>
                      <p className="text-[9px] font-bold text-[#6b7f94] uppercase tracking-wide leading-tight mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Instruction card */}
            <div className="rounded-3xl p-5" style={{ background: 'linear-gradient(145deg,#0d1929,#111827)', borderWidth: 1, borderStyle: 'solid', borderColor: '#2693ff15' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-[10px] font-black uppercase tracking-widest text-[#4a6278]">Инструкция</p>
              </div>
              <div className="space-y-2.5 text-[12px] text-[#6b7f94]">
                <div className="flex items-start gap-2"><span>🪪</span><span><span className="font-bold text-white">Паспорт</span> → раздел «Паспорт»</span></div>
                <div className="flex items-start gap-2"><span>🚗</span><span><span className="font-bold text-white">Водительские права</span> → раздел «ВУ»</span></div>
                <div className="flex items-start gap-2"><span>📋</span><span><span className="font-bold text-white">Техпаспорт</span> → раздел «ТехПаспорт»</span></div>
              </div>
            </div>

            {/* Requirements card */}
            <div className="rounded-3xl p-5" style={{ background: 'linear-gradient(145deg,#0d1929,#111827)', borderWidth: 1, borderStyle: 'solid', borderColor: '#ffffff0a' }}>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-3.5 h-3.5 text-[#5ba3f5]" />
                <p className="text-[10px] font-black uppercase tracking-widest text-[#4a6278]">Требования</p>
              </div>
              <div className="space-y-2">
                {['Чёткое фото (качество ≥ 70%)','Документ не просрочен','Все данные видны полностью','JPG, PNG — до 5 МБ'].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full mt-2 flex-shrink-0 bg-[#3d5263]" />
                    <p className="text-[12px] text-[#6b7f94]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: document cards grid */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-4 px-1">
              <FileText className="w-3.5 h-3.5 text-[#4a6278]" />
              <p className="text-[10px] font-black uppercase tracking-widest text-[#4a6278]">Список документов</p>
            </div>
            <div className={`grid gap-4 ${documents.length > 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
              {documents.map((doc) => {
                const cfg = statusConfig[doc.status] || statusConfig['not_uploaded'];
                const issue = issues[doc.id] ?? null;
                const isScanning = scanningIndex === doc.id;
                const dl = doc.expiryDate ? daysLeft(doc.expiryDate) : null;
                const sc = ({ verified: { bar: '#10b981', bg: '#10b98112', border: '#10b98120' }, rejected: { bar: '#ef4444', bg: '#ef444412', border: '#ef444420' }, pending: { bar: '#f59e0b', bg: '#f59e0b12', border: '#f59e0b20' }, not_uploaded: { bar: '#2693ff', bg: '#2693ff08', border: '#2693ff15' } } as Record<string, { bar: string; bg: string; border: string }>)[doc.status] || { bar: '#2693ff', bg: '#2693ff08', border: '#2693ff15' };
                return (
                  <div key={doc.id} className="rounded-3xl overflow-hidden relative"
                    style={{ background: 'linear-gradient(145deg,#0d1929,#111827)', borderWidth: 1, borderStyle: 'solid', borderColor: issue ? '#f9731630' : sc.border }}>
                    <div className="h-1" style={{ background: `linear-gradient(90deg,${sc.bar},${sc.bar}60,transparent)` }} />
                    <ScanlineOverlay active={isScanning} />
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                            style={{ background: sc.bg, borderWidth: 1, borderStyle: 'solid', borderColor: sc.border }}>
                            <div className={cfg.iconColor}>{DOC_ICONS[doc.type]}</div>
                          </div>
                          <div>
                            <p className="text-[15px] font-black text-white">{doc.title}</p>
                            <p className="text-[11px] text-[#6b7f94]">{doc.subtitle}</p>
                          </div>
                        </div>
                        <span className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap rounded-xl ${cfg.badge}`}>{cfg.icon}{cfg.label}</span>
                      </div>

                      <AnimatePresence>
                        {isScanning && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-blue-400" style={{ background: '#2693ff12' }}>
                              <Zap className="w-3.5 h-3.5 animate-pulse" /><span className="text-[11px] font-semibold">Анализирую документ…</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {doc.hasPhoto && doc.status !== 'not_uploaded' && !isScanning && (
                        <div className="space-y-3 mb-4">
                          <div className="flex gap-4 flex-wrap">
                            {doc.uploadDate && <div><p className="text-[9px] font-bold uppercase tracking-widest text-[#3d5263] mb-0.5">Загружено</p><p className="text-[12px] font-semibold text-[#6b7f94]">{doc.uploadDate}</p></div>}
                            {doc.expiryDate && <div>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-[#3d5263] mb-0.5">Действителен до</p>
                              <p className={`text-[12px] font-bold ${dl !== null && dl < 0 ? 'text-red-400' : dl !== null && dl <= 30 ? 'text-amber-400' : 'text-[#6b7f94]'}`}>
                                {new Date(doc.expiryDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                                {dl !== null && dl < 0 && <span className="ml-1 text-[10px]">(истёк)</span>}
                                {dl !== null && dl >= 0 && dl <= 30 && <span className="ml-1 text-[10px]">({dl} д.)</span>}
                              </p>
                            </div>}
                          </div>
                          {showResults && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-[#3d5263]">Качество фото</p>
                                <p className={`text-[11px] font-bold ${doc.photoQualityScore >= 80 ? 'text-emerald-400' : doc.photoQualityScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{qualityLabel(doc.photoQualityScore)} · {doc.photoQualityScore}%</p>
                              </div>
                              <div className="h-1.5 rounded-full overflow-hidden bg-[#1e2d3d]">
                                <motion.div className={`h-full rounded-full ${qualityColor(doc.photoQualityScore)}`} initial={{ width: 0 }} animate={{ width: `${doc.photoQualityScore}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                              </div>
                            </motion.div>
                          )}
                        </div>
                      )}

                      {showResults && issue && <div className="mb-3"><IssueBanner issue={issue} isDark={true} /></div>}

                      {doc.status === 'rejected' && doc.rejectionReason && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}
                          className={`flex gap-2 pl-3 py-2.5 border-l-2 text-[11.5px] font-medium leading-relaxed mb-3 rounded-r-xl ${doc.rejectionReason.includes('Неверный тип документа') || doc.rejectionReason.includes('не совпадает') ? 'border-l-orange-400 text-orange-300' : 'border-l-red-500 text-red-300'}`}
                          style={{ background: doc.rejectionReason.includes('Неверный') ? '#f9731608' : '#ef444408' }}>
                          {doc.rejectionReason.includes('Неверный тип документа') ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                          <div className="flex-1"><p className="font-semibold mb-1">{doc.rejectionReason.includes('Неверный тип документа') ? '⚠️ Неправильный документ!' : 'Причина отказа:'}</p><p>{doc.rejectionReason}</p></div>
                        </motion.div>
                      )}

                      <div className="border-t border-white/[0.05] pt-3">
                        <input ref={(el) => { fileInputRefs.current[`desktop_${doc.id}`] = el; }} type="file" accept="image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(doc, f); }} />
                        {doc.status === 'not_uploaded' && (
                          <button onClick={() => fileInputRefs.current[`desktop_${doc.id}`]?.click()} disabled={uploading}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl text-[13px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg,#2693ff,#1565d8)', boxShadow: '0 4px 14px rgba(38,147,255,0.25)' }}>
                            <Camera className="w-4 h-4" />{uploading ? 'Загрузка...' : 'Загрузить документ'}
                          </button>
                        )}
                        {doc.status === 'rejected' && (
                          <button onClick={() => fileInputRefs.current[`desktop_${doc.id}`]?.click()} disabled={uploading}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl text-[13px] font-bold transition-all hover:opacity-90 disabled:opacity-50"
                            style={{ background: '#ef444415', borderWidth: 1, borderStyle: 'solid', borderColor: '#ef444430', color: '#f87171' }}>
                            <Upload className="w-4 h-4" />{uploading ? 'Загрузка...' : 'Загрузить заново'}
                          </button>
                        )}
                        {doc.status === 'verified' && (
                          <div className="flex gap-3">
                            <button onClick={() => { if (doc.photoUrl) window.open(doc.photoUrl, '_blank'); }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-[12px] font-semibold text-[#6b7f94] hover:text-white transition-all"
                              style={{ background: '#ffffff08', borderWidth: 1, borderStyle: 'solid', borderColor: '#ffffff10' }}>
                              <Eye className="w-3.5 h-3.5" />Просмотреть
                            </button>
                            <button onClick={() => fileInputRefs.current[`desktop_${doc.id}`]?.click()} disabled={uploading}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-[12px] font-bold transition-all hover:opacity-80 disabled:opacity-50"
                              style={{ background: '#2693ff12', borderWidth: 1, borderStyle: 'solid', borderColor: '#2693ff25', color: '#5ba3f5' }}>
                              <Upload className="w-3.5 h-3.5" />{uploading ? 'Загрузка...' : 'Обновить'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>


      {/* ── Upload Modal ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {uploadModal.open && uploadModal.doc && (
          <motion.div
            key="upload-modal-backdrop"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/70"
              onClick={() => !modalSubmitting && setUploadModal({ open: false, doc: null, file: null })}
            />

            {/* Modal panel */}
            <motion.div
              className={`relative w-full max-w-md mx-0 sm:mx-4 sm:rounded-2xl font-['Sora'] flex flex-col mb-[72px] sm:mb-0 max-h-[calc(100dvh-100px)] sm:max-h-[88vh] overflow-hidden ${
                isDark ? 'bg-[#060e1a]' : 'bg-white'
              }`}
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              {/* Accent bar */}
              <div className="h-[3px] w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, #2693ff, #6366f1, #2693ff)' }} />

              {/* Header */}
              <div className={`flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0 border-b ${divider}`}>
                <div className={`w-9 h-9 flex items-center justify-center flex-shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  {DOC_ICONS[uploadModal.doc.type] || <FileText className="w-5 h-5" />}
                  {ocrScanning && (
                    <span className="absolute ml-4 mt-4 w-3 h-3 flex items-center justify-center">
                      <div className={`w-2.5 h-2.5 border border-t-transparent rounded-full animate-spin ${isDark ? 'border-blue-400' : 'border-blue-500'}`} />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold text-[15px] leading-tight ${textPrimary}`}>{uploadModal.doc.title}</p>
                  <p className={`text-[11px] mt-0.5 font-medium ${ocrScanning ? (isDark ? 'text-blue-400' : 'text-blue-600') : textSec}`}>
                    {ocrScanning ? '🔍 Сканирование документа…' : 'Проверьте и подтвердите данные'}
                  </p>
                </div>
                <button
                  onClick={() => !modalSubmitting && setUploadModal({ open: false, doc: null, file: null })}
                  className={`w-8 h-8 flex items-center justify-center transition-all active:scale-90 ${textSec}`}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">

                {/* OCR status */}
                <AnimatePresence mode="wait">
                  {ocrScanning ? (
                    <motion.div key="scanning" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                      <div className={`flex items-center gap-3 px-3 py-3 border-l-2 border-l-blue-400 ${
                        isDark ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        <ScanLine className="w-4 h-4 animate-pulse flex-shrink-0" />
                        <div>
                          <p className="text-[12px] font-semibold">Распознаём документ</p>
                          <p className={`text-[11px] ${isDark ? 'text-blue-400/70' : 'text-blue-600/70'}`}>ФИО и дата рождения…</p>
                        </div>
                        <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ml-auto flex-shrink-0 ${isDark ? 'border-blue-400' : 'border-blue-500'}`} />
                      </div>
                    </motion.div>
                  ) : ocrResult ? (
                    <motion.div key="result" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                      {(ocrResult.fullName || ocrResult.birthDate) ? (
                        <div className={`flex gap-3 px-3 py-3 border-l-2 border-l-emerald-500`}>
                          <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-semibold mb-1 ${isDark ? 'text-emerald-300' : 'text-emerald-800'}`}>Данные распознаны</p>
                            {ocrResult.fullName && <p className={`text-[11.5px] truncate ${isDark ? 'text-emerald-300/80' : 'text-emerald-700'}`}>{ocrResult.fullName}</p>}
                            {ocrResult.birthDate && <p className={`text-[11px] ${isDark ? 'text-emerald-400/60' : 'text-emerald-600/70'}`}>{new Date(ocrResult.birthDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
                          </div>
                        </div>
                      ) : (
                        <div className={`px-3 py-3 border-l-2 border-l-amber-400`}>
                          <div className="flex items-center gap-2 mb-1">
                            <AlertCircle className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                            <span className={`text-[12px] font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>Не удалось распознать</span>
                          </div>
                          <ul className={`text-[11px] space-y-0.5 mb-2 pl-6 ${isDark ? 'text-amber-300/70' : 'text-amber-700/80'}`}>
                            <li>• Документ должен быть хорошо освещён</li>
                            <li>• Без бликов, все 4 угла видны</li>
                          </ul>
                          {uploadModal.file && uploadModal.doc && (
                            <button
                              onClick={() => runOcrPrescan(uploadModal.file!, uploadModal.doc!.type)}
                              className={`flex items-center gap-1.5 text-[11px] font-semibold pl-6 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}
                            >
                              <RefreshCw className="w-3 h-3" />
                              Повторить сканирование
                            </button>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="hint" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                      <div className={`flex items-start gap-2 px-3 py-2 border-l-2 ${divider.replace('border-', 'border-l-')}`}>
                        <ScanLine className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
                        <p className={`text-[11.5px] leading-relaxed ${textSec}`}>
                          {uploadModal.doc.type === 'passport'
                            ? 'ФИО и дата рождения распознаются автоматически. Проверьте данные перед загрузкой.'
                            : 'ФИО должно совпадать с паспортом. При необходимости укажите срок действия.'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ФИО */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-[11px] font-semibold uppercase tracking-wider ${textSec}`}>ФИО</label>
                    <span className={`text-[10px] font-medium ${
                      uploadModal.doc.type === 'passport'
                        ? isDark ? 'text-blue-400' : 'text-blue-500'
                        : isDark ? 'text-red-400' : 'text-red-500'
                    }`}>
                      {uploadModal.doc.type === 'passport' ? 'авто' : 'обязательно'}
                    </span>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-3 border-b ${divider} focus-within:border-b-blue-400 transition-colors`}>
                    <input
                      type="text"
                      value={modalFullName}
                      onChange={(e) => setModalFullName(e.target.value)}
                      placeholder={ocrScanning ? 'Распознаём…' : 'Рахимов Фарход Саъдулло'}
                      disabled={modalSubmitting || ocrScanning}
                      className={`flex-1 bg-transparent text-[14px] font-medium outline-none ${
                        isDark ? 'text-white placeholder-[#3d5263]' : 'text-[#0f172a] placeholder-[#94a3b8]'
                      } disabled:opacity-60`}
                    />
                    {ocrScanning && <div className={`w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0 ${isDark ? 'border-blue-400' : 'border-blue-500'}`} />}
                    {!ocrScanning && ocrResult?.fullName && modalFullName === ocrResult.fullName && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                    {!ocrScanning && uploadModal.doc.type !== 'passport' && !modalFullName.trim() && <AlertCircle className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-red-400' : 'text-red-500'}`} />}
                  </div>
                  {uploadModal.doc.type !== 'passport' && !modalFullName.trim() && !ocrScanning && (
                    <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-red-400' : 'text-red-500'}`}>Должно совпадать с паспортом</p>
                  )}
                </div>

                {/* Дата рождения (паспорт + OCR) */}
                {uploadModal.doc.type === 'passport' && (ocrScanning || ocrResult?.birthDate) && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                    <label className={`text-[11px] font-semibold uppercase tracking-wider mb-1.5 block ${textSec}`}>Дата рождения</label>
                    <div className={`flex items-center gap-2 px-3 py-3 border-b ${divider} opacity-80 cursor-not-allowed`}>
                      <input
                        type="text"
                        value={ocrResult?.birthDate ? new Date(ocrResult.birthDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        readOnly disabled
                        placeholder="Из документа…"
                        className={`flex-1 bg-transparent text-[14px] font-medium outline-none ${isDark ? 'text-white placeholder-[#3d5263]' : 'text-[#0f172a] placeholder-[#94a3b8]'}`}
                      />
                      {!ocrScanning && ocrResult?.birthDate && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                      {ocrScanning && <div className={`w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0 ${isDark ? 'border-blue-400' : 'border-blue-500'}`} />}
                    </div>
                    <p className={`text-[10.5px] mt-1 ${textSec}`}>Сохранится автоматически в профиле</p>
                  </motion.div>
                )}

                {/* Срок действия */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`text-[11px] font-semibold uppercase tracking-wider ${textSec}`}>Срок действия</label>
                    <span className={`text-[10px] font-medium ${textMuted}`}>необязательно</span>
                  </div>
                  <div className={`flex border-b ${divider} overflow-hidden`}>
                    <select
                      value={modalExpiry ? modalExpiry.split('-')[2] : ''}
                      onChange={e => {
                        const parts = modalExpiry ? modalExpiry.split('-') : [String(new Date().getFullYear()), '01', ''];
                        const [y, m] = parts;
                        setModalExpiry(e.target.value ? `${y || new Date().getFullYear()}-${m || '01'}-${e.target.value}` : '');
                      }}
                      disabled={modalSubmitting}
                      className={`flex-1 px-0 py-3 text-[13px] font-medium outline-none appearance-none text-center bg-transparent border-0 ${
                        isDark ? 'text-white' : 'text-[#0f172a]'
                      } disabled:opacity-60`}
                    >
                      <option value="">День</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
                      ))}
                    </select>
                    <div className={`w-px self-stretch my-2 ${isDark ? 'bg-[#1e2d3d]' : 'bg-slate-200'}`} />
                    <select
                      value={modalExpiry ? modalExpiry.split('-')[1] : ''}
                      onChange={e => {
                        const parts = modalExpiry ? modalExpiry.split('-') : [String(new Date().getFullYear()), '', '01'];
                        const [y, , d] = parts;
                        setModalExpiry(e.target.value ? `${y || new Date().getFullYear()}-${e.target.value}-${d || '01'}` : '');
                      }}
                      disabled={modalSubmitting}
                      className={`flex-[1.5] px-0 py-3 text-[13px] font-medium outline-none appearance-none text-center bg-transparent border-0 ${
                        isDark ? 'text-white' : 'text-[#0f172a]'
                      } disabled:opacity-60`}
                    >
                      <option value="">Месяц</option>
                      {['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'].map((m, i) => (
                        <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>
                      ))}
                    </select>
                    <div className={`w-px self-stretch my-2 ${isDark ? 'bg-[#1e2d3d]' : 'bg-slate-200'}`} />
                    <select
                      value={modalExpiry ? modalExpiry.split('-')[0] : ''}
                      onChange={e => {
                        const parts = modalExpiry ? modalExpiry.split('-') : ['', '01', '01'];
                        const [, m, d] = parts;
                        setModalExpiry(e.target.value ? `${e.target.value}-${m || '01'}-${d || '01'}` : '');
                      }}
                      disabled={modalSubmitting}
                      className={`flex-[1.1] px-0 py-3 text-[13px] font-medium outline-none appearance-none text-center bg-transparent border-0 ${
                        isDark ? 'text-white' : 'text-[#0f172a]'
                      } disabled:opacity-60`}
                    >
                      <option value="">Год</option>
                      {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() + i).map(y => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                  {modalExpiryDisplay && (
                    <p className={`text-[11px] mt-1 font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                      ✓ {modalExpiryDisplay}
                    </p>
                  )}
                </div>

                {/* File preview */}
                {uploadModal.file && (
                  <div className={`flex items-center gap-3 px-3 py-2.5 border-b ${divider}`}>
                    <FileText className={`w-4 h-4 flex-shrink-0 ${textSec}`} />
                    <span className={`flex-1 text-[12px] font-medium truncate ${textSec}`}>{uploadModal.file.name}</span>
                    <span className={`text-[11px] font-medium flex-shrink-0 ${textMuted}`}>
                      {(uploadModal.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                )}

              </div>
              {/* END SCROLLABLE BODY */}

              {/* Action buttons */}
              <div className={`flex-shrink-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] border-t ${divider}`}>
                <button
                  onClick={handleModalUpload}
                  disabled={modalSubmitting || ocrScanning || (uploadModal.doc.type !== 'passport' && !modalFullName.trim())}
                  className="w-full py-3 text-[14px] font-bold text-white mb-2 transition-all active:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #2693ff 0%, #1565d8 100%)' }}
                >
                  {modalSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Загрузка…
                    </span>
                  ) : ocrScanning ? (
                    <span className="flex items-center justify-center gap-2">
                      <ScanLine className="w-4 h-4" />
                      Сканирование…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Upload className="w-4 h-4" />
                      Загрузить документ
                    </span>
                  )}
                </button>
                <button
                  onClick={() => !modalSubmitting && setUploadModal({ open: false, doc: null, file: null })}
                  disabled={modalSubmitting}
                  className={`w-full py-2 text-[13px] font-medium transition-all disabled:opacity-50 ${textSec}`}
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
