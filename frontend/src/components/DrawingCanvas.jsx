import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

const TRANSPARENT_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5l9YsAAAAASUVORK5CYII=';

const DrawingCanvas = forwardRef(({
  activeImage,
  currentStepImage,
  tool,
  brushSize,
  strokeColor,
  drawingData,
  onDrawingChange,
  layers,
  opacities,
  compareEnabled,
  comparePosition,
  zoom,
  onZoomChange,
}, ref) => {
  const canvasRef = useRef(null);
  const practiceCanvasRefs = useRef({}); 
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const isDrawingRef = useRef(false);
  const activeCanvasTypeRef = useRef('top'); // top, or sheet-xyz
  const isPanningRef = useRef(false);
  const historyStepRef = useRef(-1);
  const positionRef = useRef({});
  const panOriginRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  
  const [sheetIds, setSheetIds] = useState(['sheet-0']);
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [snapshot, setSnapshot] = useState(null);
  const [positions, setPositions] = useState({});
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const emitDrawingChange = useCallback((data) => {
    onDrawingChange?.(data);
  }, [onDrawingChange]);

  const restoreState = useCallback((data, shouldNotify = false) => {
    const topData = typeof data === 'string' ? data : data?.top || TRANSPARENT_PIXEL;
    const incomingSheets = data?.sheets || [];
    const legacyBottom = typeof data === 'string' ? TRANSPARENT_PIXEL : data?.bottom;

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (topData !== TRANSPARENT_PIXEL) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
      };
      img.src = topData || TRANSPARENT_PIXEL;
    }

    // We can only restore to canvases that currently exist in the DOM (tracked by sheetIds)
    // sheetIds state will be in sync, but wait for DOM using practiceCanvasRefs
    Object.keys(practiceCanvasRefs.current).forEach((id) => {
      const pCanvas = practiceCanvasRefs.current[id];
      if (!pCanvas) return;
      const pCtx = pCanvas.getContext('2d');

      let sheetSrc = TRANSPARENT_PIXEL;
      const incomingSheet = incomingSheets.find((s) => s.id === id);
      if (incomingSheet) {
         sheetSrc = incomingSheet.data;
      } else if (id === 'sheet-0' && legacyBottom) {
         sheetSrc = legacyBottom;
      }

      const pImg = new Image();
      pImg.onload = () => {
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        if (sheetSrc !== TRANSPARENT_PIXEL) {
          pCtx.drawImage(pImg, 0, 0, pCanvas.width, pCanvas.height);
        }
      };
      pImg.src = sheetSrc;
    });

    if (shouldNotify) {
      emitDrawingChange(data);
    }
  }, []);

  useEffect(() => {
    historyStepRef.current = historyStep;
  }, [historyStep]);

  useEffect(() => {
    positionRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (!activeImage?.id || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    // Faqat rasm o'zgarganda canvasni boshqatdan yuklash
    if (canvas.dataset.imageId === activeImage.id.toString()) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      setCanvasSize({ width: img.width, height: img.height });
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      canvas.dataset.imageId = activeImage.id.toString();

      const initialData = drawingData || { top: TRANSPARENT_PIXEL, sheets: [] };
      let newSheetIds = ['sheet-0'];
      if (initialData.sheets && initialData.sheets.length > 0) {
        newSheetIds = initialData.sheets.map(s => s.id);
      }
      setSheetIds(newSheetIds);

      // Wait a tick for React to render new sheet canvas DOM nodes
      setTimeout(() => {
        if (practiceCanvasRefs.current) {
          Object.values(practiceCanvasRefs.current).forEach((pCanvas) => {
            if (pCanvas) {
              pCanvas.width = img.width;
              pCanvas.height = img.height;
              const pCtx = pCanvas.getContext('2d');
              pCtx.clearRect(0, 0, img.width, img.height);
            }
          });
        }
        
        restoreState(initialData, false);
        setHistory([initialData]);
        setHistoryStep(0);
        historyStepRef.current = 0;
        isDrawingRef.current = false;
        isPanningRef.current = false;
        setPositions({});
        positionRef.current = {};
      }, 0);
    };
    img.src = activeImage.sketch;
  }, [activeImage?.id, activeImage?.sketch, restoreState]);

  // Handle external drawingData changes (if needed, without wiping history unexpectedly)
  useEffect(() => {
    if (!activeImage?.id || !canvasRef.current || !drawingData || history.length === 0) {
      return;
    }
    const canvas = canvasRef.current;
    if (canvas.dataset.imageId !== activeImage.id.toString()) {
      return; // Wait for initialization to finish
    }
    const currentHistoryItem = history[historyStepRef.current];
    if (drawingData !== currentHistoryItem) {
      // Faqatgina external sync bo'lganda (masalan boshqa tabdan yoki reset) canvasni yangilash
      restoreState(drawingData, false);
      setHistory([drawingData]);
      setHistoryStep(0);
      historyStepRef.current = 0;
    }
  }, [drawingData, activeImage?.id, historyStep, history, restoreState]);

  const saveHistoryState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Capture state of top and ALL dynamic practice sheets
    const sheetsData = sheetIds.map((id) => {
      const pCanvas = practiceCanvasRefs.current[id];
      return {
        id,
        data: pCanvas ? pCanvas.toDataURL('image/png') : TRANSPARENT_PIXEL,
      };
    });

    const data = {
      top: canvas.toDataURL('image/png'),
      sheets: sheetsData,
    };
    
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyStepRef.current + 1);
      newHistory.push(data);
      return newHistory;
    });
    setHistoryStep((prev) => {
      const nextStep = prev + 1;
      historyStepRef.current = nextStep;
      return nextStep;
    });
    emitDrawingChange(data);
  }, [sheetIds, emitDrawingChange]);

  const getCoordinates = (event, canvasElement) => {
    const rect = canvasElement.getBoundingClientRect();
    const scaleX = canvasElement.width / rect.width;
    const scaleY = canvasElement.height / rect.height;

    let clientX;
    let clientY;
    if (event.touches?.length) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const getPointerClientCoordinates = (event) => {
    if (event.touches?.length) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    return { x: event.clientX, y: event.clientY };
  };

  const startPan = (event, type) => {
    event.preventDefault();
    isPanningRef.current = true;
    activeCanvasTypeRef.current = type;
    const { x, y } = getPointerClientCoordinates(event);
    panOriginRef.current = {
      x,
      y,
      startX: positionRef.current[type]?.x || 0,
      startY: positionRef.current[type]?.y || 0,
    };
  };

  const movePan = (event) => {
    if (!isPanningRef.current) return;
    event.preventDefault();
    const type = activeCanvasTypeRef.current;
    const { x, y } = getPointerClientCoordinates(event);
    const next = {
      x: panOriginRef.current.startX + (x - panOriginRef.current.x) / zoom,
      y: panOriginRef.current.startY + (y - panOriginRef.current.y) / zoom,
    };
    setPositions((prev) => ({ ...prev, [type]: next }));
  };

  const stopPan = () => {
    isPanningRef.current = false;
  };

  const startDrawing = (event, type) => {
    event.preventDefault();
    if (!activeImage) return;
    if (tool === 'pan') {
      startPan(event, type);
      return;
    }

    activeCanvasTypeRef.current = type;
    const targetCanvas = type === 'top' ? canvasRef.current : practiceCanvasRefs.current[type];
    if (!targetCanvas) return;

    const { x, y } = getCoordinates(event, targetCanvas);
    const ctx = targetCanvas.getContext('2d');

    if (tool === 'bucket') {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 1; tempCanvas.height = 1;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.fillStyle = strokeColor;
      tempCtx.fillRect(0,0,1,1);
      const fillUint32 = new Uint32Array(tempCtx.getImageData(0,0,1,1).data.buffer)[0];

      const imageData = ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
      const data = new Uint32Array(imageData.data.buffer);
      
      const width = targetCanvas.width;
      const height = targetCanvas.height;
      const sx = Math.floor(x);
      const sy = Math.floor(y);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const targetColor = data[sy * width + sx];
        if (targetColor !== fillUint32) {
          // Garbage Collection UI qotib qolishini oldini olish uchun yirik qatlamni `Int32Array` orqali saqlaymiz (xotiraga kam yuk tushadi)
          const stack = new Int32Array(width * height);
          let stackPtr = 0;
          
          stack[stackPtr++] = sy * width + sx;
          data[sy * width + sx] = fillUint32;
          
          while(stackPtr > 0) {
            const pos = stack[--stackPtr];
            const py = Math.floor(pos / width);
            const px = pos % width;
            
            if (py > 0 && data[pos - width] === targetColor) {
              data[pos - width] = fillUint32;
              stack[stackPtr++] = pos - width;
            }
            if (py < height - 1 && data[pos + width] === targetColor) {
              data[pos + width] = fillUint32;
              stack[stackPtr++] = pos + width;
            }
            if (px > 0 && data[pos - 1] === targetColor) {
              data[pos - 1] = fillUint32;
              stack[stackPtr++] = pos - 1;
            }
            if (px < width - 1 && data[pos + 1] === targetColor) {
              data[pos + 1] = fillUint32;
              stack[stackPtr++] = pos + 1;
            }
          }
          ctx.putImageData(imageData, 0, 0);
          saveHistoryState();
        }
      }
      return;
    }

    isDrawingRef.current = true;
    setStartPos({ x, y });
    setSnapshot(ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height));

    ctx.beginPath();
    ctx.moveTo(x, y);

    const isShape = ['line', 'rectangle', 'circle'].includes(tool);
    if (!isShape) {
      draw(event);
    }
  };

  const draw = (event) => {
    if (tool === 'pan') {
      movePan(event);
      return;
    }
    if (!isDrawingRef.current || !activeImage) return;
    event.preventDefault();

    const targetCanvas = activeCanvasTypeRef.current === 'top' ? canvasRef.current : practiceCanvasRefs.current[activeCanvasTypeRef.current];
    if (!targetCanvas) return;

    const { x, y } = getCoordinates(event, targetCanvas);
    const ctx = targetCanvas.getContext('2d');
    const isShape = ['line', 'rectangle', 'circle'].includes(tool);

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isShape && snapshot) {
      ctx.putImageData(snapshot, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strokeColor;
      ctx.beginPath();
      if (tool === 'line') {
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(x, y);
      } else if (tool === 'rectangle') {
        ctx.rect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
      } else if (tool === 'circle') {
        const radius = Math.hypot(startPos.x - x, startPos.y - y);
        ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
      }
      ctx.stroke();
      return;
    }

    if (tool === 'pencil') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strokeColor;
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (tool === 'charcoal') {
      ctx.globalCompositeOperation = 'source-over';
      const density = Math.max(5, brushSize * 2);
      for (let index = 0; index < density; index += 1) {
        const offsetX = (Math.random() - 0.5) * brushSize * 1.2;
        const offsetY = (Math.random() - 0.5) * brushSize * 1.2;
        const alpha = Math.random() * 0.35 + 0.1;
        ctx.fillStyle = `${strokeColor}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.beginPath();
        ctx.arc(x + offsetX, y + offsetY, Math.random() * Math.max(1, brushSize * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.moveTo(x, y);
    } else if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = (event) => {
    if (event) event.preventDefault();
    if (tool === 'pan') {
      stopPan();
      return;
    }
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      saveHistoryState();
    }
  };

  const handleWheel = (event) => {
    if (!activeImage) return;
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // Delta qiymatini yumshatish trackpad va mishka orasida silliq ishlashini taminlaydi
    const delta = event.deltaY * -0.001;
    onZoomChange?.((prev) => {
      const next = typeof prev === 'number' ? prev + delta : zoom + delta;
      return Math.min(3, Math.max(0.5, Number(next.toFixed(3))));
    });
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    sheetIds.forEach((id) => {
      const pCanvas = practiceCanvasRefs.current[id];
      if (pCanvas) {
        const pCtx = pCanvas.getContext('2d');
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
      }
    });
    saveHistoryState();
  }, [sheetIds, saveHistoryState]);

  const handleAddSheet = () => {
    const newId = `sheet-${Date.now()}`;
    setSheetIds((prev) => [...prev, newId]);
    setTimeout(() => {
      const pCanvas = practiceCanvasRefs.current[newId];
      if (pCanvas && canvasSize.width) {
        pCanvas.width = canvasSize.width;
        pCanvas.height = canvasSize.height;
      }
      saveHistoryState();
    }, 0);
  };

  const handleDeleteSheet = (id) => {
    setSheetIds((prev) => prev.filter(sheetId => sheetId !== id));
    setTimeout(() => {
       saveHistoryState();
    }, 0);
  };

  const exportImage = useCallback(async (filename) => {
    if (!activeImage || !canvasRef.current) return false;

    const GAP = 40;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvasRef.current.width;
    exportCanvas.height = canvasRef.current.height * (1 + sheetIds.length) + (GAP * sheetIds.length);
    const ctx = exportCanvas.getContext('2d');

    // Fillet the background wrapper
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    const drawLayer = (src, alpha = 1, offsetX = 0, offsetY = 0) => new Promise((resolve) => {
      if (!src || src === TRANSPARENT_PIXEL) {
         resolve();
         return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, offsetX, offsetY, canvasRef.current.width, canvasRef.current.height);
        ctx.restore();
        resolve();
      };
      img.onerror = resolve;
      img.src = src;
    });

    if (layers.showOriginal) {
      await drawLayer(activeImage.original, opacities.original, 0, 0);
    }
    if (layers.showGuide) {
      await drawLayer(currentStepImage || activeImage.sketch, opacities.guide, 0, 0);
    }
    if (layers.showDrawing) {
      await drawLayer(canvasRef.current.toDataURL('image/png'), 1, 0, 0);
    }

    // Draw practice canvases below
    for (let i = 0; i < sheetIds.length; i++) {
       const sheetId = sheetIds[i];
       const pCanvas = practiceCanvasRefs.current[sheetId];
       if (pCanvas) {
         const yOffset = (i + 1) * (canvasRef.current.height + GAP);
         await drawLayer(pCanvas.toDataURL('image/png'), 1, 0, yOffset);
       }
    }

    const link = document.createElement('a');
    link.download = filename;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    return true;
  }, [activeImage, currentStepImage, layers, opacities]);

  useImperativeHandle(ref, () => ({
    undo: () => {
      if (historyStepRef.current > 0) {
        const newStep = historyStepRef.current - 1;
        setHistoryStep(newStep);
        historyStepRef.current = newStep;
        restoreState(history[newStep], true);
      }
    },
    redo: () => {
      if (historyStepRef.current < history.length - 1) {
        const newStep = historyStepRef.current + 1;
        setHistoryStep(newStep);
        historyStepRef.current = newStep;
        restoreState(history[newStep], true);
      }
    },
    clear,
    exportImage,
  }), [history, clear, exportImage, restoreState]);

  if (!activeImage) {
    return (
      <div className="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p>Chap panelda rasm yuklang va tanlang</p>
      </div>
    );
  }

  const compareClip = { clipPath: `inset(0 ${100 - comparePosition}% 0 0)` };

  return (
    <div className="canvas-container" ref={containerRef} onWheel={handleWheel}>
      <div className="canvas-stage-shell">
        <div
          className="canvas-stage"
          ref={stageRef}
          style={{
            transform: `scale(${zoom})`,
            cursor: tool === 'pan' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair',
            display: 'flex',
            flexDirection: 'column',
            gap: '40px',
            alignItems: 'center',
            boxShadow: 'none',
            background: 'transparent'
          }}
        >
          {/* TOP: Reference stage */}
          <div className="canvas-stage-internal" style={{ transform: `translate(${positions['top']?.x || 0}px, ${positions['top']?.y || 0}px)`, width: canvasSize.width || undefined, height: canvasSize.height || undefined, position: 'relative', boxShadow: '0 28px 70px rgba(45, 31, 17, 0.18)', borderRadius: '8px' }}>
            {layers.showGuide && (
              <img
                className="stage-image stage-guide"
                src={currentStepImage || activeImage.sketch}
                alt="Sketch guide"
                style={{ opacity: opacities.guide }}
              />
            )}

            {layers.showOriginal && (
              <img
                className="stage-image stage-original"
                src={activeImage.original}
                alt="Original reference"
                style={{ opacity: opacities.original }}
              />
            )}

            {compareEnabled && (
              <div className="compare-overlay" style={compareClip}>
                <img className="stage-image" src={activeImage.original} alt="Before compare" style={{ opacity: 1 }} />
                <div className="compare-line" style={{ left: `${comparePosition}%` }} />
              </div>
            )}

            <canvas
              ref={canvasRef}
              className={`drawing-layer ${layers.showDrawing ? '' : 'hidden-layer'}`}
              onMouseDown={(e) => startDrawing(e, 'top')}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={(e) => startDrawing(e, 'top')}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>

          {/* DYNAMIC BOTTOM Practice Sheets */}
          {sheetIds.map((id, index) => (
            <div key={id} className="canvas-stage-internal practice-stage" style={{ transform: `translate(${positions[id]?.x || 0}px, ${positions[id]?.y || 0}px)`, width: canvasSize.width || undefined, height: canvasSize.height || undefined, position: 'relative', background: '#ffffff', boxShadow: '0 10px 40px rgba(45, 31, 17, 0.12)', borderRadius: '8px' }}>
               <button 
                  onClick={() => handleDeleteSheet(id)} 
                  title="Qog'ozni o'chirish"
                  style={{ position: 'absolute', top: -14, right: -14, background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 50, boxShadow: '0 4px 10px rgba(255, 77, 79, 0.4)' }}
               >
                  <Trash2 size={16} />
               </button>
               <canvas
                ref={(el) => {
                  if (el) practiceCanvasRefs.current[id] = el;
                  else delete practiceCanvasRefs.current[id];
                }}
                className="drawing-layer"
                onMouseDown={(e) => startDrawing(e, id)}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={(e) => startDrawing(e, id)}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
          ))}

          {/* ADD NEW SHEET BUTTON */}
          <button 
             onClick={handleAddSheet}
             style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 28px', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)', color: '#bf5a36', border: '2px dashed rgba(191, 90, 54, 0.4)', borderRadius: '16px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', marginTop: '10px' }}
             onMouseEnter={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(191, 90, 54, 0.8)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
             onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.85)'; e.currentTarget.style.borderColor = 'rgba(191, 90, 54, 0.4)'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
             <Plus size={20} />
             Yana bitta oq qog'oz qo'shish
          </button>
        </div>
      </div>
    </div>
  );
});

export default DrawingCanvas;
