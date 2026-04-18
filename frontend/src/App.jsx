import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import imageCompression from 'browser-image-compression';
import { 
  Camera, Upload, RefreshCw, AlertTriangle, Minus, Plus, 
  Loader2, ChevronDown, ChevronUp, Box, Circle as CircleIcon, 
  CheckCircle2, Settings2, RotateCcw, MinusCircle, PlusCircle
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const App = () => {
  // Core State
  const [stream, setStream] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null); // null, 'camera', or 'upload'
  
  // Image & Detection State
  const [originalFile, setOriginalFile] = useState(null);
  const [detectionMode, setDetectionMode] = useState('circle');
  const [detectionResult, setDetectionData] = useState(null); 
  const [manualCircle, setManualCircle] = useState(null); // {x_pct, y_pct, r_pct} relative to IMAGE
  const [attempt, setAttempt] = useState(1);
  
  // Final Result State
  const [countResult, setCountResult] = useState(null);
  const [manualAdjustment, setManualAdjustment] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Workflow Step: 'idle' | 'confirm' | 'adjust' | 'result'
  const [step, setStep] = useState('idle');

  const videoRef = useRef(null);
  const adjustContainerRef = useRef(null);
  const imageRef = useRef(null);

  // --- Helpers ---
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const resetAll = () => {
    stopCamera();
    setOriginalFile(null);
    setDetectionData(null);
    setManualCircle(null);
    setCountResult(null);
    setManualAdjustment(0);
    setError(null);
    setAttempt(1);
    setStep('idle');
    setMode(null);
  };

  // --- Step 1: Detect ---
  const startDetection = async (file) => {
    setLoading(true);
    setError(null);
    setOriginalFile(file);
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1400 });
      const formData = new FormData();
      formData.append('file', compressed);
      formData.append('attempt', attempt);

      const response = await axios.post(`${API_URL}/detect`, formData);
      
      if (response.data.error) {
        setError(response.data.error + " - Use manual adjustment.");
        setStep('adjust');
        setManualCircle({ x_pct: 0.5, y_pct: 0.5, r_pct: 0.3 });
      } else {
        setDetectionData(response.data);
        setManualCircle(response.data.circle);
        setStep('confirm');
      }
    } catch (err) {
      setError("Backend connection failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleTryAgain = () => {
    const nextAttempt = attempt >= 3 ? 1 : attempt + 1;
    setAttempt(nextAttempt);
    if (originalFile) startDetection(originalFile);
  };

  // --- Step 2: Precise Adjust Logic ---
  const handleAdjustStart = (e) => {
    if (step !== 'adjust' || !imageRef.current) return;
    
    // Get actual image dimensions (ignoring letterboxing)
    const imgRect = imageRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    
    // Click position relative to the IMAGE
    const startX = (touch.clientX - imgRect.left) / imgRect.width;
    const startY = (touch.clientY - imgRect.top) / imgRect.height;
    
    // Check if dragging center or resizing
    const distToCenter = Math.sqrt(Math.pow(startX - manualCircle.x_pct, 2) + Math.pow(startY - manualCircle.y_pct, 2));
    const isResize = Math.abs(distToCenter - manualCircle.r_pct) < 0.1;

    const moveHandler = (moveEvent) => {
      const mTouch = moveEvent.touches ? moveEvent.touches[0] : moveEvent;
      const mx = (mTouch.clientX - imgRect.left) / imgRect.width;
      const my = (mTouch.clientY - imgRect.top) / imgRect.height;

      if (isResize) {
          const dx = (mx - manualCircle.x_pct) * imgRect.width;
          const dy = (my - manualCircle.y_pct) * imgRect.height;
          const pixelR = Math.sqrt(dx*dx + dy*dy);
          const maxDim = Math.max(imgRect.width, imgRect.height);
          setManualCircle(prev => ({ ...prev, r_pct: pixelR / maxDim }));
      } else {
          setManualCircle(prev => ({ ...prev, x_pct: mx, y_pct: my }));
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
    window.addEventListener('touchmove', moveHandler);
    window.addEventListener('touchend', upHandler);
  };

  // --- Step 3: Count ---
  const runCount = async (isManual = false) => {
    setLoading(true);
    setError(null);
    try {
      const compressed = await imageCompression(originalFile, { maxSizeMB: 0.5, maxWidthOrHeight: 1400 });
      const formData = new FormData();
      formData.append('file', compressed);
      formData.append('detection_mode', detectionMode);
      
      const coords = isManual ? manualCircle : detectionResult.circle;
      formData.append('cx_pct', coords.x_pct);
      formData.append('cy_pct', coords.y_pct);
      formData.append('r_pct', coords.r_pct);

      const response = await axios.post(`${API_URL}/count`, formData);
      if (response.data.error) {
        setError(response.data.error);
      } else {
        setCountResult(response.data);
        setStep('result');
      }
    } catch (err) {
      setError("Count processing failed.");
    } finally {
      setLoading(false);
    }
  };

  const startCamera = async () => {
    resetAll();
    setMode('camera');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      setStream(mediaStream);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = mediaStream; }, 100);
    } catch (err) {
      setError("Camera access denied.");
      setMode('upload');
    }
  };

  const capture = useCallback(() => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
      canvas.toBlob((blob) => {
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        startDetection(file);
      }, 'image/jpeg', 0.95);
      stopCamera();
    }
  }, [videoRef, attempt]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) startDetection(file);
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0f172a] text-slate-50 font-sans selection:bg-blue-500/30">
      <header className="sticky top-0 z-30 w-full bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">🦐 ShrimpCount</h1>
          {(step !== 'idle') && (
            <button onClick={resetAll} className="text-xs font-bold uppercase tracking-widest text-slate-400">Reset</button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto px-6 pt-6 pb-32">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-2 text-red-200 text-xs font-medium italic">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* --- Input Selection --- */}
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
                <button onClick={capture} className="mx-auto w-20 h-20 rounded-full bg-white border-8 border-slate-800 flex items-center justify-center active:scale-90 transition-transform">
                  <div className="w-12 h-12 rounded-full bg-blue-600" />
                </button>
              </div>
            ) : mode === 'upload' ? (
              <label className="w-full aspect-square flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-[2.5rem] bg-slate-800/30 hover:bg-slate-800/50 cursor-pointer">
                <Upload size={48} className="mb-4 text-blue-400" />
                <span className="text-slate-300 font-bold text-sm">Choose from Gallery</span>
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            ) : (
              <>
                <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
                  <Camera size={32} className="text-blue-400" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold uppercase tracking-tight">Counting Mode</h2>
                  <p className="text-slate-400 text-xs">Standardize your bowl detection area.</p>
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

        {/* --- Step 1: Detection Preview --- */}
        {step === 'confirm' && detectionResult && !loading && (
          <div className="flex-1 flex flex-col space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="text-center">
              <h3 className="text-lg font-bold">Bowl Detected</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Step 1: Verify Detection Area</p>
            </div>
            
            <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-slate-800 shadow-2xl bg-black flex items-center justify-center">
              <img src={detectionResult.preview} className="max-w-full max-h-full object-contain" alt="Preview" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={handleTryAgain} className="flex flex-col items-center justify-center p-4 bg-slate-800 rounded-2xl border border-slate-700 active:scale-95 transition-all">
                <RotateCcw size={18} className="mb-1 text-blue-400" />
                <span className="text-[9px] font-black uppercase tracking-tighter">Rescan ({attempt})</span>
              </button>
              <button onClick={() => setStep('adjust')} className="flex flex-col items-center justify-center p-4 bg-slate-800 rounded-2xl border border-slate-700 active:scale-95 transition-all">
                <Settings2 size={18} className="mb-1 text-amber-400" />
                <span className="text-[9px] font-black uppercase tracking-tighter">Adjust</span>
              </button>
              <button onClick={() => runCount(false)} className="flex flex-col items-center justify-center p-4 bg-emerald-600 rounded-2xl border border-emerald-500 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">
                <CheckCircle2 size={18} className="mb-1 text-white" />
                <span className="text-[9px] font-black uppercase tracking-tighter">Looks Good</span>
              </button>
            </div>
          </div>
        )}

        {/* --- Step 2: Manual Adjust Mode --- */}
        {step === 'adjust' && !loading && (
          <div className="flex-1 flex flex-col space-y-4 animate-in fade-in duration-300">
            <div className="text-center">
              <h3 className="text-lg font-bold text-amber-400 font-black italic">Precision Adjust</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Step 2: Manually Select Area</p>
            </div>

            <div 
              ref={adjustContainerRef}
              onMouseDown={handleAdjustStart}
              onTouchStart={handleAdjustStart}
              className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-amber-500/30 shadow-2xl bg-black cursor-crosshair touch-none flex items-center justify-center"
            >
              <img 
                ref={imageRef}
                src={originalFile ? URL.createObjectURL(originalFile) : ''} 
                className="max-w-full max-h-full object-contain pointer-events-none opacity-70 transition-opacity" 
                alt="Original" 
              />
              
              {/* SVG Perfectly Overlaying the Image Boundaries */}
              {imageRef.current && (
                <svg 
                   style={{
                     position: 'absolute',
                     left: imageRef.current.offsetLeft,
                     top: imageRef.current.offsetTop,
                     width: imageRef.current.clientWidth,
                     height: imageRef.current.clientHeight
                   }}
                   className="pointer-events-none"
                >
                  <circle 
                    cx={`${manualCircle.x_pct * 100}%`} 
                    cy={`${manualCircle.y_pct * 100}%`} 
                    r={`${manualCircle.r_pct * (Math.max(imageRef.current.clientWidth, imageRef.current.clientHeight) / imageRef.current.clientWidth) * 100}%`} 
                    fill="rgba(251, 191, 36, 0.15)" 
                    stroke="#fbbf24" 
                    strokeWidth="3" 
                  />
                  <circle cx={`${manualCircle.x_pct * 100}%`} cy={`${manualCircle.y_pct * 100}%`} r="4" fill="#fbbf24" />
                </svg>
              )}

              <div className="absolute top-4 left-4 bg-black/80 backdrop-blur px-3 py-1.5 rounded-full border border-amber-500/20 text-[9px] font-mono text-amber-400 tracking-tight flex gap-3">
                <span>X:{(manualCircle.x_pct*100).toFixed(0)}%</span>
                <span>Y:{(manualCircle.y_pct*100).toFixed(0)}%</span>
                <span>R:{(manualCircle.r_pct*100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="flex justify-center gap-4">
              <button 
                onClick={() => setManualCircle(prev => ({ ...prev, r_pct: Math.max(0.05, prev.r_pct - 0.01) }))}
                className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-xs font-bold"
              >
                <MinusCircle size={18} className="text-red-400" /> Smaller
              </button>
              <button 
                onClick={() => setManualCircle(prev => ({ ...prev, r_pct: Math.min(0.5, prev.r_pct + 0.01) }))}
                className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 text-xs font-bold"
              >
                <PlusCircle size={18} className="text-emerald-400" /> Larger
              </button>
            </div>

            <button onClick={() => runCount(true)} className="h-16 w-full bg-blue-600 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">
              Count Final Area
            </button>
          </div>
        )}

        {/* --- Step 3: Result --- */}
        {step === 'result' && countResult && !loading && (
          <div className="flex-1 flex-col space-y-8 animate-in slide-in-from-bottom-8 duration-700 flex">
            <div className="text-center space-y-1">
              <p className="text-[10px] font-black tracking-[0.3em] text-slate-500 uppercase">Estimated Shrimp</p>
              <h3 className="text-[7.5rem] leading-none font-black text-white tracking-tighter drop-shadow-2xl">
                {countResult.count + manualAdjustment}
              </h3>
              <div className={`inline-flex px-6 py-2 rounded-full text-[10px] font-black tracking-widest uppercase shadow-lg ${getConfidenceStyles(countResult.confidence)}`}>
                {countResult.confidence} CONFIDENCE
              </div>
            </div>

            <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-slate-800 bg-black flex items-center justify-center shadow-inner">
              <img src={countResult.overlay} className="max-w-full max-h-full object-contain" alt="Final Overlay" />
            </div>

            <div className="flex items-center justify-between bg-slate-800/50 rounded-3xl p-2 border border-slate-700">
              <button onClick={() => setManualAdjustment(prev => prev - 1)} className="h-14 w-16 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 text-red-400 shadow-sm active:scale-95 transition-all">
                <Minus size={24} strokeWidth={3} />
              </button>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Fine Adjustment</span>
                <span className="text-lg font-bold tabular-nums">{manualAdjustment > 0 ? `+${manualAdjustment}` : manualAdjustment}</span>
              </div>
              <button onClick={() => setManualAdjustment(prev => prev + 1)} className="h-14 w-16 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 text-emerald-400 shadow-sm active:scale-95 transition-all">
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 animate-pulse">
            <Loader2 size={56} className="text-blue-500 animate-spin" />
            <p className="text-sm font-black tracking-[0.2em] text-blue-400 uppercase">Processing...</p>
          </div>
        )}
      </main>

      {step === 'idle' && !loading && (
        <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/95 to-transparent z-40">
          <div className="max-w-md mx-auto flex gap-4">
            <button onClick={startCamera} className={`flex-1 h-16 flex items-center justify-center gap-3 rounded-2xl font-black uppercase text-xs transition-all ${mode === 'camera' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
              <Camera size={20} /> Camera
            </button>
            <button onClick={() => {stopCamera(); setMode('upload');}} className={`flex-1 h-16 flex items-center justify-center gap-3 rounded-2xl font-black uppercase text-xs transition-all ${mode === 'upload' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
              <Upload size={20} /> Upload
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
