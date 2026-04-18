import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import imageCompression from 'browser-image-compression';
import { 
  Camera, Upload, RefreshCw, AlertTriangle, Minus, Plus, 
  Loader2, ChevronDown, ChevronUp, Box, Circle as CircleIcon, 
  CheckCircle2, Settings2, RotateCcw 
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
  const [detectionResult, setDetectionData] = useState(null); // Result from /detect
  const [manualCircle, setManualCircle] = useState(null); // Adjusted {x_pct, y_pct, r_pct}
  const [attempt, setAttempt] = useState(1);
  
  // Final Result State
  const [countResult, setCountResult] = useState(null);
  const [manualAdjustment, setManualAdjustment] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Workflow Step: 'idle' | 'confirm' | 'adjust' | 'result'
  const [step, setStep] = useState('idle');

  const videoRef = useRef(null);
  const adjustContainerRef = useRef(null);

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
      // Compress first
      const compressed = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1400 });
      
      const formData = new FormData();
      formData.append('file', compressed);
      formData.append('attempt', attempt);

      const response = await axios.post(`${API_URL}/detect`, formData);
      
      if (response.data.error) {
        // Fallback to manual adjust if detection fails completely
        setError(response.data.error + " - Try manual adjustment.");
        setStep('adjust');
        setManualCircle({ x_pct: 0.5, y_pct: 0.5, r_pct: 0.3 });
      } else {
        setDetectionData(response.data);
        setManualCircle(response.data.circle);
        setStep('confirm');
      }
    } catch (err) {
      setError("Connection error. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const handleTryAgain = () => {
    const nextAttempt = attempt >= 3 ? 1 : attempt + 1;
    setAttempt(nextAttempt);
    if (originalFile) startDetection(originalFile);
  };

  // --- Step 2: Adjust Logic ---
  const handleAdjustStart = (e) => {
    if (step !== 'adjust') return;
    const rect = adjustContainerRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    
    // Simple logic: if click near center, drag. If click near edge, resize.
    const dist = Math.sqrt(Math.pow(x - manualCircle.x_pct, 2) + Math.pow(y - manualCircle.y_pct, 2));
    const isEdge = Math.abs(dist - manualCircle.r_pct) < 0.05;

    const moveHandler = (moveEvent) => {
      const mTouch = moveEvent.touches ? moveEvent.touches[0] : moveEvent;
      const mx = (mTouch.clientX - rect.left) / rect.width;
      const my = (mTouch.clientY - rect.top) / rect.height;

      if (isEdge) {
        const newR = Math.sqrt(Math.pow(mx - manualCircle.x_pct, 2) + Math.pow(my - manualCircle.y_pct, 2));
        setManualCircle(prev => ({ ...prev, r_pct: newR }));
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
      setError("Failed to process count.");
    } finally {
      setLoading(false);
    }
  };

  // --- Camera Actions ---
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

  // --- Render Helpers ---
  const getConfidenceStyles = (conf) => {
    if (conf === 'HIGH') return 'bg-emerald-500 text-white';
    if (conf === 'MEDIUM') return 'bg-amber-500 text-slate-900';
    return 'bg-red-500 text-white';
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
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-2 text-red-200 text-xs font-medium">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* --- Phase 1: Idle/Input --- */}
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

        {/* --- Phase 2: Confirm Circle --- */}
        {step === 'confirm' && detectionResult && !loading && (
          <div className="flex-1 flex flex-col space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold">Bowl Detected</h3>
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

        {/* --- Phase 3: Adjust Mode --- */}
        {step === 'adjust' && !loading && (
          <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-300">
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-amber-400">Manual Adjust</h3>
              <p className="text-xs text-slate-400">Drag center to move, drag edge to resize.</p>
            </div>

            <div 
              ref={adjustContainerRef}
              onMouseDown={handleAdjustStart}
              onTouchStart={handleAdjustStart}
              className="relative aspect-[3/4] rounded-[2rem] overflow-hidden border-2 border-amber-500/30 shadow-2xl bg-black cursor-move touch-none"
            >
              <img src={originalFile ? URL.createObjectURL(originalFile) : ''} className="w-full h-full object-contain pointer-events-none opacity-60" alt="Original" />
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <circle 
                  cx={`${manualCircle.x_pct * 100}%`} 
                  cy={`${manualCircle.y_pct * 100}%`} 
                  r={`${manualCircle.r_pct * 100 * 0.75}%`} // Simple hack for radius viz
                  fill="rgba(255, 191, 0, 0.2)" 
                  stroke="#fbbf24" 
                  strokeWidth="3" 
                />
                {/* Visual Handle */}
                <circle 
                   cx={`${manualCircle.x_pct * 100}%`} 
                   cy={`${(manualCircle.y_pct + manualCircle.r_pct * 0.75) * 100}%`} 
                   r="8" fill="#fbbf24" 
                />
              </svg>
            </div>

            <button onClick={() => runCount(true)} className="h-16 w-full bg-blue-600 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">
              Count This Area
            </button>
          </div>
        )}

        {/* --- Phase 4: Result --- */}
        {step === 'result' && countResult && !loading && (
          <div className="flex-1 flex flex-col space-y-8 animate-in slide-in-from-bottom-8 duration-700">
            <div className="text-center space-y-2">
              <p className="text-xs font-black tracking-[0.3em] text-slate-500 uppercase">Shrimp Count ({detectionMode})</p>
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

      {step === 'idle' && !loading && (
        <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/95 to-transparent z-40">
          <div className="max-w-md mx-auto flex gap-4">
            <button onClick={startCamera} className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl font-bold transition-all ${mode === 'camera' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              <Camera size={20} /><span>Camera</span>
            </button>
            <button onClick={() => {stopCamera(); setMode('upload');}} className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl font-bold transition-all ${mode === 'upload' ? 'bg-blue-600 shadow-lg' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
              <Upload size={20} /><span>Upload</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
