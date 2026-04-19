import React, { useEffect, useMemo, useRef, useState } from 'react';
import DrawingCanvas from './components/DrawingCanvas';
import {
  Circle,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Image as ImageIcon,
  Layers,
  Minus,
  PaintBucket,
  Pencil,
  PenTool,
  Redo,
  RotateCcw,
  Search,
  Square,
  Trash2,
  Undo,
  Upload,
  PencilLine,
  ZoomIn,
  ZoomOut,
  CloudUpload,
  CloudDownload,
} from 'lucide-react';
import './index.css';

const envApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = envApiBaseUrl ? envApiBaseUrl.replace(/\/$/, '') : '';
const buildApiUrl = (path) => `${API_BASE_URL}${path}`;
const STORAGE_KEY = 'artist-platform-session-v2';
const MAX_IMAGES = 4;

const sketchStyles = [
  { id: 'canny', label: 'Classic', description: 'Aniq kontur va 3 bosqichli o‘rganish.' },
  { id: 'soft', label: 'Soft', description: 'Yumshoqroq, boshlovchilar uchun qulay.' },
  { id: 'portrait', label: 'Portrait', description: 'Portret uchun kuchliroq yuz chiziqlari.' },
];

const defaultLayerState = {
  showOriginal: true,
  showGuide: true,
  showDrawing: true,
};

const defaultOpacityState = {
  original: 0.22,
  guide: 0.95,
};

function loadStoredSession() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return null;
    }
    return JSON.parse(saved);
  } catch (error) {
    console.warn('Autosave session yuklanmadi:', error);
    return null;
  }
}

function getAuthorId() {
  return '';
}

function getUploadErrorMessage(error, fileName) {
  if (error instanceof TypeError) {
    return `Rasm (${fileName}) ni backendga yuborib bo'lmadi. Backend serverni ishga tushiring yoki frontend/.env ichida VITE_API_BASE_URL ni tekshiring.`;
  }

  if (error instanceof Error && error.message) {
    return `Rasm (${fileName}) ni yuklashda xatolik yuz berdi: ${error.message}`;
  }

  return `Rasm (${fileName}) ni yuklashda noma'lum xatolik yuz berdi.`;
}

async function parseApiResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = text ? { detail: text } : null;
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.message || fallbackMessage;
    throw new Error(message);
  }

  return payload;
}

function App() {
  const initialSession = useMemo(() => loadStoredSession(), []);
  const [images, setImages] = useState(() => Array.isArray(initialSession?.images) ? initialSession.images : []);
  const [activeIndex, setActiveIndex] = useState(() => (typeof initialSession?.activeIndex === 'number' ? initialSession.activeIndex : -1));
  const [activeStep, setActiveStep] = useState(() => (typeof initialSession?.activeStep === 'number' ? initialSession.activeStep : 2));
  const [tool, setTool] = useState('pencil');
  const [brushSize, setBrushSize] = useState(() => initialSession?.brushSize || 5);
  const [strokeColor, setStrokeColor] = useState(() => initialSession?.strokeColor || '#2d3748');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(() => initialSession?.selectedStyle || 'canny');
  const [layers, setLayers] = useState(() => ({ ...defaultLayerState, ...(initialSession?.layers || {}) }));
  const [opacities, setOpacities] = useState(() => ({ ...defaultOpacityState, ...(initialSession?.opacities || {}) }));
  const [compareEnabled, setCompareEnabled] = useState(() => Boolean(initialSession?.compareEnabled));
  const [comparePosition, setComparePosition] = useState(() => (typeof initialSession?.comparePosition === 'number' ? initialSession.comparePosition : 50));
  const [zoom, setZoom] = useState(() => (typeof initialSession?.zoom === 'number' ? initialSession.zoom : 1));
  const [editingImageId, setEditingImageId] = useState(null);
  const canvasRef = useRef(null);

  const [token, setToken] = useState(() => localStorage.getItem('artist-token') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('artist-username') || '');
  const [isAuthMode, setIsAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          images,
          activeIndex,
          selectedStyle,
          strokeColor,
          brushSize,
          layers,
          opacities,
          activeStep,
          compareEnabled,
          comparePosition,
          zoom,
        }),
      );
    } catch (error) {
      console.warn('Autosave session saqlanmadi:', error);
    }
  }, [images, activeIndex, selectedStyle, strokeColor, brushSize, layers, opacities, activeStep, compareEnabled, comparePosition, zoom]);

  const activeImage = images[activeIndex];
  const statusMessage = isUploading
    ? `Rasmlar ${selectedStyle} style bilan tayyorlanmoqda...`
    : activeImage
      ? `${activeImage.name} tayyor. Progress autosave qilinadi.`
      : 'Rasm yuklang va chizishni boshlang.';

  const updateActiveImage = (updater) => {
    setImages((prev) => {
      if (activeIndex < 0 || activeIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      next[activeIndex] = updater(next[activeIndex]);
      return next;
    });
  };

  const handleRenameImage = (imageId) => {
    const target = images.find((image) => image.id === imageId);
    if (!target) {
      return;
    }
    const nextName = window.prompt('Rasm uchun yangi nom kiriting:', target.name);
    if (!nextName) {
      return;
    }
    setImages((prev) => prev.map((image) => (
      image.id === imageId
        ? { ...image, name: nextName.trim() || image.name }
        : image
    )));
    setEditingImageId(null);
  };

  const handleDeleteImage = (imageId) => {
    const targetIndex = images.findIndex((image) => image.id === imageId);
    if (targetIndex === -1) {
      return;
    }

    setImages((prev) => prev.filter((image) => image.id !== imageId));
    setActiveIndex((prevIndex) => {
      if (images.length <= 1) {
        return -1;
      }
      if (prevIndex > targetIndex) {
        return prevIndex - 1;
      }
      if (prevIndex === targetIndex) {
        return Math.max(0, prevIndex - 1);
      }
      return prevIndex;
    });
  };

  const handleResetSession = () => {
    setImages([]);
    setActiveIndex(-1);
    setActiveStep(2);
    setCompareEnabled(false);
    setComparePosition(50);
    setZoom(1);
    setEditingImageId(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleCloudSave = async () => {
    if (images.length === 0) {
      alert("Oldin rasm yuklang va chizing!");
      return;
    }
    const saveName = window.prompt("Loyiha nomi qanday bo'lsin? (Masalan: Tabiat manzarasi)");
    if (!saveName) return;

    try {
      const payload = {
        name: saveName,
        data: {
          images,
          activeIndex,
          selectedStyle,
          strokeColor,
          brushSize,
          layers,
          opacities,
          activeStep,
          compareEnabled,
          comparePosition,
          zoom
        }
      };
      
      const res = await fetch(buildApiUrl('/api/projects'), {
        method: "POST",
        headers: { 
           "Content-Type": "application/json",
           "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      
      if (res.status === 401) {
         setToken('');
         localStorage.removeItem('artist-token');
         throw new Error("Sessiyangiz yakunlangan, qayta kiring!");
      }
      
      const json = await parseApiResponse(res, "Xatolik yuz berdi");
      alert(json.message);
    } catch (err) {
      alert("Saqlashda xatolik: " + err.message);
    }
  };

  const handleCloudLoad = async () => {
    try {
      const res = await fetch(buildApiUrl('/api/projects'), {
         headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.status === 401) {
         setToken('');
         localStorage.removeItem('artist-token');
         throw new Error("Sessiyangiz yakunlangan, qayta kiring!");
      }
      
      const json = await parseApiResponse(res, "Loyihalarni olishda xato");
      const list = json.projects || [];
      if (list.length === 0) {
         alert("Sizda hali bulutga saqlangan loyihalar yo'q. Oldin 'Bulutga saqlash' qiling.");
         return;
      }
      
      const text = list.map((p, i) => `${i+1}. ${p.name}`).join('\n');
      const numStr = window.prompt(`Qaysi loyihani yuklamoqchisiz? Raqamini kiriting:\n\n${text}`);
      if (!numStr) return;
      
      const idx = parseInt(numStr, 10) - 1;
      if (idx >= 0 && idx < list.length) {
          const p_id = list[idx].id;
          const dRes = await fetch(buildApiUrl(`/api/projects/${p_id}`), {
             headers: { "Authorization": `Bearer ${token}` }
          });
          const dData = await parseApiResponse(dRes, "Xatolik");
          const { data } = dData;
          if (data && data.images) {
            setImages(data.images);
            if (typeof data.activeIndex === 'number') setActiveIndex(data.activeIndex);
            if (data.selectedStyle) setSelectedStyle(data.selectedStyle);
            if (data.strokeColor) setStrokeColor(data.strokeColor);
            if (data.brushSize) setBrushSize(data.brushSize);
            if (data.layers) setLayers({...defaultLayerState, ...data.layers});
            if (data.opacities) setOpacities({...defaultOpacityState, ...data.opacities});
            if (typeof data.activeStep === 'number') setActiveStep(data.activeStep);
            if (typeof data.compareEnabled === 'boolean') setCompareEnabled(data.compareEnabled);
            if (typeof data.comparePosition === 'number') setComparePosition(data.comparePosition);
            if (typeof data.zoom === 'number') setZoom(data.zoom);
            alert(`Loyiha '${list[idx].name}' yuklandi!`);
          }
      }
    } catch (err) {
      alert("Yuklashda xatolik: " + err.message);
    }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (images.length + files.length > MAX_IMAGES) {
      alert(`Biz platforma orqali jami ${MAX_IMAGES} ta rasm yuklashni tavsiya etamiz.`);
      files.splice(MAX_IMAGES - images.length);
      if (files.length === 0) return;
    }

    setIsUploading(true);

    const newImages = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('style', selectedStyle);

      try {
        const response = await fetch(buildApiUrl('/api/sketch'), {
          method: 'POST',
          body: formData,
        });
        const data = await parseApiResponse(response, 'Server xatosi');
        const reader = new FileReader();
        const originalBase64 = await new Promise((resolve) => {
          reader.onload = (event) => resolve(event.target.result);
          reader.readAsDataURL(file);
        });

        newImages.push({
          id: Date.now() + Math.random(),
          original: originalBase64,
          sketch: data.sketch,
          steps: data.steps,
          style: data.style,
          name: file.name,
          drawingData: data.initial_drawing || null,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Xatolik:', error);
        alert(getUploadErrorMessage(error, file.name));
      }
    }

    if (newImages.length > 0) {
      setImages((prev) => {
        const updated = [...prev, ...newImages];
        if (activeIndex === -1 || prev.length === 0) {
          setActiveIndex(0);
        }
        return updated;
      });
    }

    setIsUploading(false);
    e.target.value = '';
  };

  const handleDrawingChange = (drawingData) => {
    updateActiveImage((current) => ({
      ...current,
      drawingData,
    }));
  };

  const handleClearCanvas = () => {
    canvasRef.current?.clear();
  };

  const handleExport = async () => {
    if (!activeImage) return;
    await canvasRef.current?.exportImage(`${activeImage.name.replace(/\.[^.]+$/, '') || 'drawing'}.png`);
  };

  const toggleLayer = (key) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleLayerCount = useMemo(
    () => Object.values(layers).filter(Boolean).length,
    [layers],
  );

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!authForm.username || !authForm.password) return;
    setAuthLoading(true);
    try {
      const endpoint = isAuthMode === 'login' ? '/api/login' : '/api/register';
      const res = await fetch(buildApiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await parseApiResponse(res, 'Xatolik');
      if (data.token) {
        setToken(data.token);
        setUsername(data.username);
        localStorage.setItem('artist-token', data.token);
        localStorage.setItem('artist-username', data.username);
      }
    } catch (err) {
      alert(err.message);
    }
    setAuthLoading(false);
  };

  if (!token) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f0eb' }}>
        <div style={{ padding: '40px', background: '#ffffff', borderRadius: '16px', width: '380px', boxShadow: '0 20px 40px rgba(45,31,17,0.08)' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <img src="/logo.png" alt="Logo" style={{ width: '48px', height: '48px', marginBottom: '16px' }} />
            <h2 style={{ color: '#2d1f11', margin: 0, fontSize: '24px' }}>Artist Platform</h2>
            <p style={{ color: '#726052', fontSize: '14px', marginTop: '8px' }}>Shaxsiy loyihalaringizni saqlang</p>
          </div>
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input type="text" placeholder="Ism (Kamida 3 harf)" value={authForm.username} onChange={e => setAuthForm({...authForm, username: e.target.value})} style={{ padding: '14px', border: '1px solid #e1dcd7', borderRadius: '10px', fontSize: '16px' }} />
            <input type="password" placeholder="Parol (Kamida 4 belgi)" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} style={{ padding: '14px', border: '1px solid #e1dcd7', borderRadius: '10px', fontSize: '16px' }} />
            <button type="submit" disabled={authLoading} style={{ padding: '14px', background: '#2d1f11', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '8px' }}>{authLoading ? 'Yuklanmoqda...' : (isAuthMode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish")}</button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '14px', cursor: 'pointer', color: '#A6513A', fontWeight: 500 }} onClick={() => setIsAuthMode(prev => prev === 'login' ? 'register' : 'login')}>
            {isAuthMode === 'login' ? "Akkaunt yo'qmi? Ro'yxatdan o'tish" : "Akkaunt bormi? Kirish"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <aside className="gallery-panel">
        <div className="gallery-header">
          <div className="heading-row">
            <div className="brand-block">
              <img className="brand-logo" src="/logo.png" alt="Artist Platform logo" />
              <div>
                <h1>Artist Platform</h1>
                <p className="section-copy">{username} - Mening ishim</p>
                <button 
                  onClick={() => {
                     setToken('');
                     setUsername('');
                     localStorage.removeItem('artist-token');
                     localStorage.removeItem('artist-username');
                     fetch(buildApiUrl('/api/logout'), { method: "POST", headers: { "Authorization": `Bearer ${token}` } }).catch(()=>0);
                  }}
                  style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', padding: 0, textDecoration: 'underline', marginTop: '4px', fontSize: '13px' }}
                >
                  Akkauntdan chiqish
                </button>
              </div>
            </div>
            <span className="style-pill">{selectedStyle}</span>
          </div>

          <button
            className="upload-btn"
            onClick={() => document.getElementById('file-upload').click()}
            disabled={isUploading || images.length >= MAX_IMAGES}
          >
            <Upload size={18} />
            Rasm Yuklash {images.length > 0 ? `(${images.length}/${MAX_IMAGES})` : ''}
          </button>
          <input
            id="file-upload"
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
          />

          <div className="gallery-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="secondary-btn" type="button" onClick={() => handleCloudSave()} style={{ flex: 1 }}>
                <CloudUpload size={16} />
                Bulutga saqlash
              </button>
              <button className="secondary-btn" type="button" onClick={() => handleCloudLoad()} style={{ flex: 1 }}>
                <CloudDownload size={16} />
                Bulutdan yuklash
              </button>
            </div>
            <button className="secondary-btn" type="button" onClick={() => handleResetSession()}>
              <Trash2 size={16} />
              Reset Session
            </button>
          </div>

          <div className="control-card">
            <div className="control-card-header">
              <Search size={16} />
              <span>Sketch Style</span>
            </div>
            <div className="style-grid">
              {sketchStyles.map((style) => (
                <button
                  key={style.id}
                  className={`style-option ${selectedStyle === style.id ? 'active' : ''}`}
                  onClick={() => setSelectedStyle(style.id)}
                  type="button"
                >
                  <strong>{style.label}</strong>
                  <span>{style.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-card">
            <div className="control-card-header">
              <Layers size={16} />
              <span>Layer Control</span>
            </div>
            <div className="layer-list">
              <button className={`layer-toggle ${layers.showOriginal ? 'active' : ''}`} onClick={() => toggleLayer('showOriginal')} type="button">
                {layers.showOriginal ? <Eye size={16} /> : <EyeOff size={16} />}
                Original
              </button>
              <button className={`layer-toggle ${layers.showGuide ? 'active' : ''}`} onClick={() => toggleLayer('showGuide')} type="button">
                {layers.showGuide ? <Eye size={16} /> : <EyeOff size={16} />}
                Sketch
              </button>
              <button className={`layer-toggle ${layers.showDrawing ? 'active' : ''}`} onClick={() => toggleLayer('showDrawing')} type="button">
                {layers.showDrawing ? <Eye size={16} /> : <EyeOff size={16} />}
                Drawing
              </button>
            </div>
            <div className="stat-row">
              <span>{visibleLayerCount} layer yoqilgan</span>
              <button className={`mini-toggle ${compareEnabled ? 'active' : ''}`} onClick={() => setCompareEnabled((prev) => !prev)} type="button">
                Before / After
              </button>
            </div>
            {compareEnabled && (
              <label className="range-stack">
                <span>Compare slider: {comparePosition}%</span>
                <input type="range" min="0" max="100" value={comparePosition} onChange={(e) => setComparePosition(Number.parseInt(e.target.value, 10))} />
              </label>
            )}
            <label className="range-stack">
              <span>Original opacity: {Math.round(opacities.original * 100)}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(opacities.original * 100)}
                onChange={(e) => setOpacities((prev) => ({ ...prev, original: Number.parseInt(e.target.value, 10) / 100 }))}
              />
            </label>
            <label className="range-stack">
              <span>Sketch opacity: {Math.round(opacities.guide * 100)}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(opacities.guide * 100)}
                onChange={(e) => setOpacities((prev) => ({ ...prev, guide: Number.parseInt(e.target.value, 10) / 100 }))}
              />
            </label>
          </div>
        </div>

        <div className="image-list">
          {isUploading && <div className="loading-text">Process qilinmoqda ({selectedStyle})...</div>}

          {images.map((img, index) => (
            <div
              key={img.id}
              className={`image-item ${index === activeIndex ? 'active' : ''}`}
            >
              <button className="image-preview-btn" onClick={() => setActiveIndex(index)} type="button">
                <img src={img.sketch} alt={img.name} />
              </button>
              <div className="image-item-label">
                <strong>{img.name}</strong>
                <span>{img.style || 'canny'} style</span>
              </div>
              <div className="image-card-actions">
                <button
                  className={`icon-action ${editingImageId === img.id ? 'active' : ''}`}
                  onClick={() => {
                    setEditingImageId(img.id);
                    handleRenameImage(img.id);
                  }}
                  type="button"
                  title="Nomini o'zgartirish"
                >
                  <PencilLine size={16} />
                </button>
                <button
                  className="icon-action danger"
                  onClick={() => handleDeleteImage(img.id)}
                  type="button"
                  title="Rasmni o'chirish"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {images.length === 0 && !isUploading && (
            <div className="empty-gallery">
              <ImageIcon size={28} />
              <p>Chap tomonda gallery paydo bo‘lishi uchun rasm yuklang. Maksimum 4 ta rasm.</p>
            </div>
          )}
        </div>
      </aside>

      <main className="canvas-panel">
        <div className="toolbar toolbar-main">
          <div className="toolbar-group">
            <button className={`tool-btn ${tool === 'pencil' ? 'active' : ''}`} onClick={() => setTool('pencil')} title="Qalam" type="button">
              <Pencil size={20} />
            </button>
            <button className={`tool-btn ${tool === 'charcoal' ? 'active' : ''}`} onClick={() => setTool('charcoal')} title="Ko'mir qalam" type="button">
              <PenTool size={20} />
            </button>
            <button className={`tool-btn ${tool === 'bucket' ? 'active' : ''}`} onClick={() => setTool('bucket')} title="Bo'yash (Bucket)" type="button">
              <PaintBucket size={20} />
            </button>
            <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} title="O'chirg'ich" type="button">
              <Eraser size={20} />
            </button>
            <button className={`tool-btn ${tool === 'line' ? 'active' : ''}`} onClick={() => setTool('line')} title="To'g'ri chiziq" type="button">
              <Minus size={20} />
            </button>
            <button className={`tool-btn ${tool === 'rectangle' ? 'active' : ''}`} onClick={() => setTool('rectangle')} title="To'rtburchak" type="button">
              <Square size={20} />
            </button>
            <button className={`tool-btn ${tool === 'circle' ? 'active' : ''}`} onClick={() => setTool('circle')} title="Aylana" type="button">
              <Circle size={20} />
            </button>
            <button className={`tool-btn ${tool === 'pan' ? 'active' : ''}`} onClick={() => setTool('pan')} title="Pan / drag" type="button">
              <Hand size={20} />
            </button>
          </div>

          <div className="toolbar-group toolbar-range">
            <label className="inline-label">
              <span>Qalinligi: {brushSize}px</span>
              <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(Number.parseInt(e.target.value, 10))} />
            </label>
          </div>

          <div className="toolbar-group toolbar-color">
            <label className="inline-label">
              <span>Rang</span>
              <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
            </label>
          </div>

          <div className="toolbar-group toolbar-group-steps">
            <span className="tool-label">Bosqich:</span>
            {[0, 1, 2].map((step) => (
              <button
                key={step}
                className={`tool-btn step-btn ${activeStep === step ? 'active' : ''}`}
                onClick={() => setActiveStep(step)}
                type="button"
              >
                {step + 1}
              </button>
            ))}
          </div>

          <div className="toolbar-group toolbar-group-actions">
            <button className="tool-btn" onClick={() => canvasRef.current?.undo()} title="Undo" type="button">
              <Undo size={20} />
            </button>
            <button className="tool-btn" onClick={() => canvasRef.current?.redo()} title="Redo" type="button">
              <Redo size={20} />
            </button>
            <button className="tool-btn" onClick={handleClearCanvas} title="Clear canvas" type="button">
              <RotateCcw size={20} />
            </button>
            <button className="tool-btn" onClick={() => setZoom((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(1))))} title="Zoom out" type="button">
              <ZoomOut size={20} />
            </button>
            <button className="tool-btn" onClick={() => setZoom((prev) => Math.min(3, Number((prev + 0.1).toFixed(1))))} title="Zoom in" type="button">
              <ZoomIn size={20} />
            </button>
            <button className="tool-btn export-btn" onClick={handleExport} title="PNG export" type="button">
              <Download size={20} />
            </button>
          </div>
        </div>

        <div className="toolbar toolbar-sub">
          <div className="status-chip">{statusMessage}</div>
          <div className="toolbar-group toolbar-range compact">
            <label className="inline-label">
              <span>Zoom: {Math.round(zoom * 100)}%</span>
              <input type="range" min="50" max="300" value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number.parseInt(e.target.value, 10) / 100)} />
            </label>
          </div>
          <div className="meta-chip">Autosave: on</div>
          <div className="meta-chip">Tool: {tool}</div>
        </div>

        <DrawingCanvas
          ref={canvasRef}
          activeImage={activeImage}
          currentStepImage={activeImage ? activeImage.steps[activeStep] : null}
          tool={tool}
          brushSize={brushSize}
          strokeColor={strokeColor}
          drawingData={activeImage?.drawingData || null}
          onDrawingChange={handleDrawingChange}
          layers={layers}
          opacities={opacities}
          compareEnabled={compareEnabled}
          comparePosition={comparePosition}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </main>
    </div>
  );
}

export default App;
