import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import imageCompression from 'browser-image-compression';
import {
  Camera, Upload, AlertTriangle, Minus, Plus,
  Loader2, ChevronDown, ChevronUp, Box, Circle as CircleIcon,
  CheckCircle2, Settings2, RotateCcw
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const MIN_CIRCLE_RADIUS = 0.04;
const CIRCLE_SIZE_STEP = 0.015;
const MIN_RECT_SIZE = 0.16;
const RECT_SIZE_STEP = 0.04;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const App = () => {
  const [stream, setStream] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null);

  const [originalFile, setOriginalFile] = useState(null);
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState(null);
  const [detectionMode, setDetectionMode] = useState('circle');
  const [detectionResult, setDetectionData] = useState(null);
  const [manualShape, setManualShape] = useState(null);
  const [attempt, setAttempt] = useState(1);
  const [adjustImageBox, setAdjustImageBox] = useState(null);

  const [countResult, setCountResult] = useState(null);
  const [manualAdjustment, setManualAdjustment] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);

  const [step, setStep] = useState('idle');

  const videoRef = useRef(null);
  const adjustContainerRef = useRef(null);
  const adjustImageRef = useRef(null);
  const previewUrlRef = useRef(null);

  const updateOriginalPreviewUrl = useCallback((file) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (!file) {
      setOriginalPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setOriginalPreviewUrl(nextUrl);
  }, []);

  useEffect(() => () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const createFallbackShape = useCallback(() => {
    if (detectionMode === 'rectangle') {
      return { type: 'rectangle', x_pct: 0.2, y_pct: 0.2, w_pct: 0.6, h_pct: 0.6 };
    }
    return { type: 'circle', x_pct: 0.5, y_pct: 0.5, r_pct: 0.3 };
  }, [detectionMode]);

  const resetAll = useCallback(() => {
    stopCamera();
    updateOriginalPreviewUrl(null);
    setOriginalFile(null);
    setDetectionData(null);
    setManualShape(null);
    setAdjustImageBox(null);
    setCountResult(null);
    setManualAdjustment(0);
    setHistoryItems([]);
    setError(null);
    setAttempt(1);
    setStep('idle');
    setMode(null);
  }, [stopCamera, updateOriginalPreviewUrl]);

  const getImageNaturalSize = useCallback(() => {
    const image = adjustImageRef.current;
    if (image?.naturalWidth && image?.naturalHeight) {
      return { width: image.naturalWidth, height: image.naturalHeight };
    }
    return { width: 1, height: 1 };
  }, []);

  const fitCircleToImage = useCallback((circle) => {
    const { width, height } = getImageNaturalSize();
    const maxEdge = Math.max(width, height);
    const xPct = clamp(circle.x_pct, 0, 1);
    const yPct = clamp(circle.y_pct, 0, 1);
    const maxRadiusByBounds = Math.min(
      (xPct * width) / maxEdge,
      ((1 - xPct) * width) / maxEdge,
      (yPct * height) / maxEdge,
      ((1 - yPct) * height) / maxEdge
    );
    const rPct = clamp(
      circle.r_pct,
      MIN_CIRCLE_RADIUS,
      Math.max(MIN_CIRCLE_RADIUS, maxRadiusByBounds)
    );
    return { ...circle, x_pct: xPct, y_pct: yPct, r_pct: rPct };
  }, [getImageNaturalSize]);

  const fitRectangleToImage = useCallback((rectangle) => {
    const wPct = clamp(rectangle.w_pct, MIN_RECT_SIZE, 1);
    const hPct = clamp(rectangle.h_pct, MIN_RECT_SIZE, 1);
    const xPct = clamp(rectangle.x_pct, 0, 1 - wPct);
    const yPct = clamp(rectangle.y_pct, 0, 1 - hPct);
    return { ...rectangle, x_pct: xPct, y_pct: yPct, w_pct: wPct, h_pct: hPct };
  }, []);

  const normalizeSelection = useCallback((selection) => {
    if (!selection) {
      return createFallbackShape();
    }

    if (selection.type === 'rectangle' || selection.w_pct !== undefined) {
      return fitRectangleToImage({
        type: 'rectangle',
        x_pct: selection.x_pct,
        y_pct: selection.y_pct,
        w_pct: selection.w_pct,
        h_pct: selection.h_pct,
      });
    }

    return {
      type: 'circle',
      x_pct: clamp(selection.x_pct, 0, 1),
      y_pct: clamp(selection.y_pct, 0, 1),
      r_pct: clamp(selection.r_pct, MIN_CIRCLE_RADIUS, 0.49),
    };
  }, [createFallbackShape, fitRectangleToImage]);

  const measureAdjustImageBox = useCallback(() => {
    const container = adjustContainerRef.current;
    const image = adjustImageRef.current;
    if (!container || !image?.naturalWidth || !image?.naturalHeight) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const scale = Math.min(containerRect.width / naturalWidth, containerRect.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const left = (containerRect.width - width) / 2;
    const top = (containerRect.height - height) / 2;

    return {
      left,
      top,
      width,
      height,
      naturalWidth,
      naturalHeight,
      clientLeft: containerRect.left + left,
      clientTop: containerRect.top + top,
    };
  }, []);

  const updateAdjustImageBox = useCallback(() => {
    const nextBox = measureAdjustImageBox();
    if (nextBox) {
      setAdjustImageBox(nextBox);
    }
  }, [measureAdjustImageBox]);

  useEffect(() => {
    const onResize = () => updateAdjustImageBox();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateAdjustImageBox]);

  useEffect(() => {
    if (step !== 'adjust') {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => updateAdjustImageBox());
    return () => window.cancelAnimationFrame(frame);
  }, [step, originalPreviewUrl, updateAdjustImageBox]);

  const getPointerPosition = useCallback((event) => {
    const imageBox = measureAdjustImageBox();
    if (!imageBox) {
      return null;
    }

    const point = event.touches ? event.touches[0] : event;
    return {
      x_pct: clamp((point.clientX - imageBox.clientLeft) / imageBox.width, 0, 1),
      y_pct: clamp((point.clientY - imageBox.clientTop) / imageBox.height, 0, 1),
    };
  }, [measureAdjustImageBox]);

  const startDetection = async (file, attemptOverride = attempt) => {
    setLoading(true);
    setError(null);
    setOriginalFile(file);
    updateOriginalPreviewUrl(file);
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1400 });

      const formData = new FormData();
      formData.append('file', compressed);
      formData.append('attempt', attemptOverride);
      formData.append('detection_mode', detectionMode);

      const response = await axios.post(`${API_URL}/detect`, formData);

      if (response.data.error) {
        setError(`${response.data.error} - Try manual adjustment.`);
        setStep('adjust');
        setManualShape(createFallbackShape());
      } else {
        const selection = normalizeSelection(response.data.selection || response.data.circle);
        setDetectionData({ ...response.data, selection });
        setManualShape(selection);
        setStep('confirm');
      }
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleTryAgain = () => {
    const nextAttempt = attempt >= 3 ? 1 : attempt + 1;
    setAttempt(nextAttempt);
    if (originalFile) {
      startDetection(originalFile, nextAttempt);
    }
  };

  const handleAdjustStart = (event) => {
    if (step !== 'adjust' || !manualShape) return;

    const startPointer = getPointerPosition(event);
    if (!startPointer) return;

    event.preventDefault();
    const startShape = manualShape;

    const moveHandler = (moveEvent) => {
      const nextPointer = getPointerPosition(moveEvent);
      if (!nextPointer) return;

      const dx = nextPointer.x_pct - startPointer.x_pct;
      const dy = nextPointer.y_pct - startPointer.y_pct;

      if (startShape.type === 'rectangle') {
        setManualShape(fitRectangleToImage({
          ...startShape,
          x_pct: startShape.x_pct + dx,
          y_pct: startShape.y_pct + dy,
        }));
      } else {
        setManualShape(fitCircleToImage({
          ...startShape,
          x_pct: startShape.x_pct + dx,
          y_pct: startShape.y_pct + dy,
        }));
      }
    };

    const upHandler = () => {
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
      window.removeEventListener('touchmove', moveHandler);
      window.removeEventListener('touchend', upHandler);
    };

    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    window.addEventListener('touchmove', moveHandler, { passive: false });
    window.addEventListener('touchend', upHandler);
  };

  const resizeManualShape = (direction) => {
    if (!manualShape) return;

    if (manualShape.type === 'rectangle') {
      const delta = direction * RECT_SIZE_STEP;
      const nextWidth = manualShape.w_pct + delta;
      const nextHeight = manualShape.h_pct + delta;
      const centerX = manualShape.x_pct + (manualShape.w_pct / 2);
      const centerY = manualShape.y_pct + (manualShape.h_pct / 2);
      setManualShape(fitRectangleToImage({
        ...manualShape,
        x_pct: centerX - (nextWidth / 2),
        y_pct: centerY - (nextHeight / 2),
        w_pct: nextWidth,
        h_pct: nextHeight,
      }));
      return;
    }

    setManualShape(fitCircleToImage({
      ...manualShape,
      r_pct: manualShape.r_pct + (direction * CIRCLE_SIZE_STEP),
    }));
  };

  const runCount = async (isManual = false) => {
    setLoading(true);
    setError(null);
    try {
      const compressed = await imageCompression(originalFile, { maxSizeMB: 0.5, maxWidthOrHeight: 1400 });
      const formData = new FormData();
      formData.append('file', compressed);

      const selection = isManual ? manualShape : detectionResult?.selection;
      const normalizedSelection = normalizeSelection(selection);
      formData.append('detection_mode', normalizedSelection.type);

      if (normalizedSelection.type === 'rectangle') {
        formData.append('rect_x_pct', normalizedSelection.x_pct);
        formData.append('rect_y_pct', normalizedSelection.y_pct);
        formData.append('rect_w_pct', normalizedSelection.w_pct);
        formData.append('rect_h_pct', normalizedSelection.h_pct);
      } else {
        formData.append('cx_pct', normalizedSelection.x_pct);
        formData.append('cy_pct', normalizedSelection.y_pct);
        formData.append('r_pct', normalizedSelection.r_pct);
      }

      const response = await axios.post(`${API_URL}/count`, formData);

      if (response.data.error) {
        setError(response.data.error);
      } else {
        setCountResult(response.data);
        setStep('result');
      }
    } catch {
      setError('Failed to process count.');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    stopCamera();
    setMode(null);
    setStep('history');
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}/history`, { params: { limit: 15 } });
      setHistoryItems(response.data.items || []);
      if (response.data.error) {
        setError(response.data.error);
      }
    } catch {
      setError('Failed to load history.');
      setHistoryItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustBack = () => {
    if (detectionResult) {
      setStep('confirm');
      return;
    }
    resetAll();
  };

  const startCamera = async () => {
    resetAll();
    setMode('camera');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      setStream(mediaStream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch {
      setError('Camera access denied.');
      setMode('upload');
    }
  };

  const capture = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      canvas.toBlob((blob) => {
        const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
        startDetection(file);
      }, 'image/jpeg', 0.95);
      stopCamera();
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) startDetection(file);
  };

  const getConfidenceStyles = (conf) => {
    if (conf === 'HIGH') return 'bg-emerald-500 text-white';
    if (conf === 'MEDIUM') return 'bg-amber-500 text-slate-900';
    return 'bg-red-500 text-white';
  };

  const renderManualOverlay = () => {
    if (!manualShape || !adjustImageBox) return null;

    const { naturalWidth, naturalHeight, left, top, width, height } = adjustImageBox;
    const sharedProps = {
      fill: 'rgba(255, 191, 0, 0.2)',
      stroke: '#fbbf24',
      strokeWidth: 3,
    };

    return (
      <div
        className="absolute pointer-events-none"
        style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
      >
        <svg className="w-full h-full" viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}>
          {manualShape.type === 'rectangle' ? (
            <>
              <rect
                x={manualShape.x_pct * naturalWidth}
                y={manualShape.y_pct * naturalHeight}
                width={manualShape.w_pct * naturalWidth}
                height={manualShape.h_pct * naturalHeight}
                {...sharedProps}
              />
              <circle
                cx={(manualShape.x_pct + manualShape.w_pct) * naturalWidth}
                cy={(manualShape.y_pct + manualShape.h_pct) * naturalHeight}
                r="9"
                fill="#fbbf24"
              />
            </>
          ) : (
            <>
              <circle
                cx={manualShape.x_pct * naturalWidth}
                cy={manualShape.y_pct * naturalHeight}
                r={manualShape.r_pct * Math.max(naturalWidth, naturalHeight)}
                {...sharedProps}
              />
              <circle
                cx={(manualShape.x_pct * naturalWidth) + (manualShape.r_pct * Math.max(naturalWidth, naturalHeight))}
                cy={manualShape.y_pct * naturalHeight}
                r="9"
                fill="#fbbf24"
              />
            </>
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0f172a] text-slate-50 font-sans selection:bg-blue-500/30">
      <header className="sticky top-0 z-30 w-full bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">🦐 ShrimpCount</h1>
          {step !== 'idle' && (
            <button onClick={resetAll} className="text-xs font-bold uppercase tracking-widest text-slate-400">Reset</button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto px-6 pt-6 pb-32">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-2 text-red-200 text-xs font-medium">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'idle' && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in duration-500">
            {mode === 'camera' ? (
              <div className="w-full space-y-6">
                <div className="relative aspect-[3/4] bg-black rounded-[2rem] overflow-hidden border-4 border-slate-800 shadow-2xl">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <circle cx="50%" cy="50%" r="35%" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="8 4" className="opacity-50" />
                  </svg>
                </div>
                <button onClick={capture} className="mx-auto w-20 h-20 rounded-full bg-white border-8 border-slate-800 flex items-center justify-center active:scale-90 transition-transform shadow-xl">
                  <div className="w-12 h-12 rounded-full bg-blue-600" />
                </button>
              </div>
            ) : mode === 'upload' ? (
              <label className="w-full aspect-square flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-[2.5rem] bg-slate-800/30 hover:bg-slate-800/50 cursor-pointer">
                <Upload size={48} className="mb-4 text-blue-400" />
                <span className="text-slate-300 font-bold">Choose from Gallery</span>
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            ) : (
              <>
                <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
                  <Camera size={40} className="text-blue-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">Ready to count?</h2>
                  <p className="text-slate-400 text-sm">Pick your detection mode and upload a photo.</p>
                </div>
                <div className="bg-slate-800/50 p-1.5 rounded-2xl border border-slate-700 flex">
                  <button onClick={() => setDetectionMode('circle')} className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all ${detectionMode === 'circle' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>
                    <CircleIcon size={14} />Circle
                  </button>
                  <button onClick={() => setDetectionMode('rectangle')} className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all ${detectionMode === 'rectangle' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>
                    <Box size={14} />Rectangle
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'history' && !loading && (
          <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-300 pb-4">
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold">Recent Counts</h3>
              <p className="text-xs text-slate-400">Latest 15 successful counts saved to history.</p>
            </div>

            {historyItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center rounded-[2rem] border border-slate-800 bg-slate-900/40 px-6 text-center text-sm text-slate-400">
                No saved history yet.
              </div>
            ) : (
              <div className="grid gap-4">
                {historyItems.map((item) => (
                  <div key={item.id} className="overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-900/50 shadow-xl">
                    <div className="aspect-[4/3] bg-black">
                      <img src={item.image} className="w-full h-full object-cover" alt={`History ${item.timestamp}`} />
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">{item.detection_mode}</p>
                          <p className="text-3xl font-black text-white leading-none">{item.count ?? '-'}</p>
                        </div>
                        <div className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase ${getConfidenceStyles(item.confidence)}`}>
                          {item.confidence || 'N/A'}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400">{item.timestamp || 'Unknown timestamp'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'confirm' && detectionResult && !loading && (
          <div className="flex-1 flex flex-col space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold">Area Detected</h3>
              <p className="text-xs text-slate-400">Confirm the area before counting.</p>
            </div>

            <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-slate-800 shadow-2xl bg-black">
              <img src={detectionResult.preview} className="w-full h-full object-contain" alt="Preview" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={handleTryAgain} className="flex flex-col items-center justify-center p-4 bg-slate-800 rounded-2xl border border-slate-700 hover:bg-slate-700">
                <RotateCcw size={18} className="mb-2 text-blue-400" />
                <span className="text-[10px] font-bold uppercase tracking-tighter">Try Again ({attempt})</span>
              </button>
              <button onClick={() => setStep('adjust')} className="flex flex-col items-center justify-center p-4 bg-slate-800 rounded-2xl border border-slate-700 hover:bg-slate-700">
                <Settings2 size={18} className="mb-2 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-tighter">Adjust</span>
              </button>
              <button onClick={() => runCount(false)} className="col-span-1 flex flex-col items-center justify-center p-4 bg-emerald-600 rounded-2xl border border-emerald-500 shadow-lg shadow-emerald-500/20">
                <CheckCircle2 size={18} className="mb-2 text-white" />
                <span className="text-[10px] font-bold uppercase tracking-tighter">Looks Good</span>
              </button>
            </div>
          </div>
        )}

        {step === 'adjust' && !loading && manualShape && (
          <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-300">
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-amber-400">Manual Adjust</h3>
              <p className="text-xs text-slate-400">Drag to move. Use - / + to resize the area.</p>
            </div>

            <div
              ref={adjustContainerRef}
              onMouseDown={handleAdjustStart}
              onTouchStart={handleAdjustStart}
              className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-amber-500/30 shadow-2xl bg-black cursor-move touch-none"
            >
              <img
                ref={adjustImageRef}
                src={originalPreviewUrl || ''}
                onLoad={updateAdjustImageBox}
                className="w-full h-full object-contain pointer-events-none opacity-60"
                alt="Original"
              />
              {renderManualOverlay()}
            </div>

            <div className="flex items-center justify-between bg-slate-800/50 rounded-3xl p-2 border border-slate-700">
              <button onClick={() => resizeManualShape(-1)} className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-red-400">
                <Minus size={24} strokeWidth={3} />
              </button>
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 tracking-tighter">Shape</span>
                <span className="text-sm font-bold capitalize text-white">{manualShape.type}</span>
              </div>
              <button onClick={() => resizeManualShape(1)} className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-emerald-400">
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleAdjustBack} className="h-16 w-full bg-slate-800 text-slate-100 rounded-2xl font-black uppercase tracking-widest border border-slate-700 active:scale-95 transition-all">
                Back
              </button>
              <button onClick={() => runCount(true)} className="h-16 w-full bg-blue-600 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">
                Count This Area
              </button>
            </div>
          </div>
        )}

        {step === 'result' && countResult && !loading && (
          <div className="flex-1 flex flex-col space-y-8 animate-in slide-in-from-bottom-8 duration-700">
            <div className="text-center space-y-2">
              <p className="text-xs font-black tracking-[0.3em] text-slate-500 uppercase">Shrimp Count ({countResult.detection_mode})</p>
              <h3 className="text-[7rem] leading-none font-black text-white tracking-tighter drop-shadow-2xl">
                {countResult.count + manualAdjustment}
              </h3>
              <div className={`inline-flex px-6 py-2 rounded-full text-xs font-black tracking-widest uppercase shadow-lg ${getConfidenceStyles(countResult.confidence)}`}>
                {countResult.confidence} Confidence
              </div>

              <div className="pt-2">
                <button onClick={() => setShowBreakdown(!showBreakdown)} className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Method Details {showBreakdown ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
                {showBreakdown && (
                  <div className="mt-4 p-4 bg-slate-900/50 border border-slate-800 rounded-2xl text-left">
                    <table className="w-full text-[11px] text-slate-400 font-medium">
                      <tbody>
                        {Object.entries(countResult.methods).map(([name, count]) => (
                          <tr key={name} className="border-b border-slate-800/50">
                            <td className="py-2 capitalize">{name.replace('_', ' ')}:</td>
                            <td className="py-2 text-right font-bold text-white">{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="relative aspect-[3/4] rounded-3xl overflow-hidden border-2 border-slate-800 bg-black">
              <img src={countResult.overlay} className="w-full h-full object-contain" alt="Final Overlay" />
            </div>

            <div className="flex items-center justify-between bg-slate-800/50 rounded-3xl p-2 border border-slate-700">
              <button onClick={() => setManualAdjustment(prev => prev - 1)} className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-red-400">
                <Minus size={24} strokeWidth={3} />
              </button>
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 tracking-tighter">Adjusted</span>
                <span className="text-xl font-bold">{manualAdjustment > 0 ? `+${manualAdjustment}` : manualAdjustment}</span>
              </div>
              <button onClick={() => setManualAdjustment(prev => prev + 1)} className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-emerald-400">
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 animate-pulse">
            <Loader2 size={48} className="text-blue-400 animate-spin" />
            <p className="text-lg font-bold tracking-widest text-blue-400 uppercase">Processing...</p>
          </div>
        )}
      </main>

      {(step === 'idle' || step === 'history') && !loading && (
        <footer className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/95 to-transparent z-40">
          <div className="max-w-md mx-auto grid grid-cols-3 gap-3">
            <button onClick={startCamera} className={`h-12 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm transition-all ${mode === 'camera' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              <Camera size={20} /><span>Camera</span>
            </button>
            <button onClick={() => { stopCamera(); setStep('idle'); setMode('upload'); }} className={`h-12 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm transition-all ${mode === 'upload' && step === 'idle' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              <Upload size={20} /><span>Upload</span>
            </button>
            <button onClick={loadHistory} className={`h-12 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm transition-all ${step === 'history' ? 'bg-blue-600 shadow-lg text-white' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              <span>History</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
