import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import imageCompression from 'browser-image-compression';
import { Camera, Upload, RefreshCw, AlertTriangle, Minus, Plus, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const App = () => {
  const [stream, setStream] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [manualAdjustment, setManualAdjustment] = useState(0);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null); // null, 'camera', or 'upload'

  const videoRef = useRef(null);
  const longPressTimer = useRef(null);

  // Initialize Camera - Now manually triggered
  const startCamera = async () => {
    setMode('camera');
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      setStream(mediaStream);
      // Use a small timeout to ensure the video element is rendered before setting srcObject
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (err) {
      console.error("Camera error:", err);
      setError("Could not access camera. Please use upload mode.");
      setMode('upload');
    }
  };

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const processImage = async (file) => {
    setLoading(true);
    setError(null);
    stopCamera();
    try {
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1400,
        useWebWorker: true
      };
      const compressedFile = await imageCompression(file, options);
      const formData = new FormData();
      formData.append('file', compressedFile, 'capture.jpg');

      const response = await axios.post(`${API_URL}/count`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setResult(response.data);
      setManualAdjustment(0);
      setMode(null);
    } catch (err) {
      console.error("Upload error:", err);
      setError("Failed to process image. Is the backend running?");
    } finally {
      setLoading(false);
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
        processImage(file);
      }, 'image/jpeg', 0.95);
    }
  }, [videoRef]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) processImage(file);
  };

  const getConfidenceStyles = (conf) => {
    if (conf === 'HIGH') return 'bg-emerald-500 text-white';
    if (conf === 'MEDIUM') return 'bg-amber-500 text-slate-900';
    return 'bg-red-500 text-white';
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0f172a] text-slate-50 font-sans selection:bg-blue-500/30">
      {/* App Header */}
      <header className="sticky top-0 z-30 w-full bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="mr-2">🦐</span>ShrimpCount
          </h1>
          {result && (
            <button 
              onClick={() => {setResult(null); setMode(null);}}
              className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition"
            >
              Reset
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto px-6 pt-8 pb-32">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl flex items-center gap-3 text-red-200">
            <AlertTriangle size={20} className="shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {!result && !mode && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
              <Camera size={40} className="text-blue-400" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Ready to count?</h2>
              <p className="text-slate-400 text-sm px-8">Align your bowl under even lighting for the most accurate results.</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 animate-pulse">
            <Loader2 size={48} className="text-blue-400 animate-spin" />
            <p className="text-lg font-bold tracking-widest text-blue-400 uppercase">Analyzing...</p>
          </div>
        )}

        {mode === 'camera' && !loading && (
          <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-300">
            <div className="relative w-full aspect-[3/4] bg-black rounded-[2.5rem] overflow-hidden border-4 border-slate-800 shadow-2xl">
              <video 
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <circle 
                  cx="50%" cy="50%" r="35%" 
                  fill="none" 
                  stroke="#10b981" 
                  strokeWidth="3" 
                  strokeDasharray="12 8"
                  className="opacity-60"
                />
                <text 
                  x="50%" y="88%" 
                  textAnchor="middle" 
                  fill="white" 
                  className="text-[10px] font-bold uppercase tracking-[0.2em] fill-emerald-400 drop-shadow-md"
                >
                  Place bowl inside the circle
                </text>
              </svg>
            </div>
            <button 
              onClick={capture}
              className="mx-auto w-20 h-20 rounded-full bg-white border-8 border-slate-800 flex items-center justify-center active:scale-90 transition-transform shadow-lg shadow-white/10"
            >
              <div className="w-12 h-12 rounded-full bg-blue-600" />
            </button>
          </div>
        )}

        {mode === 'upload' && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center animate-in slide-in-from-bottom-4 duration-300">
            <label className="w-full aspect-square flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-[2.5rem] bg-slate-800/30 hover:bg-slate-800/50 cursor-pointer transition-all active:scale-[0.98]">
              <Upload size={48} className="mb-4 text-blue-400" />
              <span className="text-slate-300 font-bold">Choose from Gallery</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        )}

        {result && !loading && (
          <div className="flex-1 flex flex-col space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Hero Count Display */}
            <div className="text-center space-y-2">
              <p className="text-xs font-black tracking-[0.3em] text-slate-500 uppercase">Shrimp Count</p>
              <h3 className="text-[8rem] leading-none font-black text-white tracking-tighter drop-shadow-2xl">
                {result.count + manualAdjustment}
              </h3>
              <div className={`inline-flex px-6 py-2 rounded-full text-xs font-black tracking-widest uppercase shadow-lg ${getConfidenceStyles(result.confidence)}`}>
                {result.confidence} Confidence
              </div>
            </div>

            {/* Overlay Image */}
            <div className="relative rounded-3xl overflow-hidden border-2 border-slate-800 bg-slate-900 shadow-2xl">
              <img 
                src={result.overlay} 
                alt="Detection Overlay" 
                className="w-full h-auto"
              />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/10 rounded-3xl" />
            </div>

            {/* Tap-to-correct row */}
            <div className="flex items-center justify-between bg-slate-800/50 rounded-3xl p-2 border border-slate-700">
              <button 
                onClick={() => setManualAdjustment(prev => prev - 1)}
                className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 active:scale-95 transition-all text-red-400"
              >
                <Minus size={24} strokeWidth={3} />
              </button>
              
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Adjusted</span>
                <span className={`text-xl font-bold ${manualAdjustment !== 0 ? 'text-blue-400' : 'text-slate-300'}`}>
                  {manualAdjustment > 0 ? `+${manualAdjustment}` : manualAdjustment}
                </span>
              </div>

              <button 
                onClick={() => setManualAdjustment(prev => prev + 1)}
                className="h-14 w-20 flex items-center justify-center bg-slate-800 rounded-2xl border border-slate-700 active:bg-slate-700 active:scale-95 transition-all text-emerald-400"
              >
                <Plus size={24} strokeWidth={3} />
              </button>
            </div>

            {result.confidence_flag && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3">
                <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                <p className="text-xs text-amber-200/80 leading-relaxed font-medium">
                  Result reliability is limited. Consider retaking in shade or centering the bowl.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Fixed Footer Actions */}
      {!loading && (
        <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/95 to-transparent z-40">
          <div className="max-w-md mx-auto flex gap-4">
            <button 
              onClick={startCamera}
              className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl font-bold transition-all active:scale-95 ${mode === 'camera' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}
            >
              <Camera size={20} />
              <span>Camera</span>
            </button>
            <button 
              onClick={() => {stopCamera(); setMode('upload');}}
              className={`flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl font-bold transition-all active:scale-95 ${mode === 'upload' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}
            >
              <Upload size={20} />
              <span>Upload</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
