import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Trophy, Timer, Eye, AlertCircle, RefreshCw } from 'lucide-react';

// Game Constants
const MEMORIZATION_TIME = 30;
const GAME_WORDS = [
  "APPLE", "BANANA", "CHERRY", "DRAGON", "EAGLE", 
  "FALCON", "GRAPE", "HONEY", "IGLOO", "JOKER",
  "KITE", "LEMON", "MANGO", "NIGHT", "ORANGE",
  "PEACH", "QUEEN", "ROBOT", "STORM", "TIGER",
  "UMBRELLA", "VALLEY", "WATER", "XYLO", "YACHT",
  "ZEBRA", "CLOUD", "BREAD", "CHAIR", "FLOWER"
];
const JUMBLED_WORDS = [
  "PIZZA", "QUARTZ", "RIVER", "SNAKE", "GHOST",
  "PIANO", "OCEAN", "SPACE", "MUSIC", "DREAM",
  "LIGHT", "HEART", "EARTH", "WORLD", "SMILE"
];

interface FallingBlock {
  id: number;
  word: string;
  x: number;
  y: number;
  speed: number;
  side: 'left' | 'right';
  isTarget: boolean;
  status: 'active' | 'caught' | 'missed';
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'memorize' | 'playing' | 'gameover'>('loading');
  const [targetWords, setTargetWords] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(MEMORIZATION_TIME);
  const [score, setScore] = useState(0);
  const [targetWordsProcessed, setTargetWordsProcessed] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(null);
  const blocksRef = useRef<FallingBlock[]>([]);
  const lastBlinkTime = useRef<number>(0);
  const nextBlockId = useRef(0);
  const targetWordsSpawned = useRef<number>(0);

  // Initialize MediaPipe
  useEffect(() => {
    async function setup() {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });
        landmarkerRef.current = landmarker;
        setPhase('memorize');
        
        // Pick 20 random target words
        const shuffled = [...GAME_WORDS].sort(() => 0.5 - Math.random());
        setTargetWords(shuffled.slice(0, 20));
        setScore(0); // Start with zero points
      } catch (err) {
        console.error(err);
        setError("Failed to initialize Face Landmarker. Please check your connection.");
      }
    }
    setup();
  }, []);

  // Camera and Resize effects
  useEffect(() => {
    let stream: MediaStream | null = null;
    let checkInterval: number | null = null;

    async function startCamera() {
      try {
        const constraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          }
        };
        
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
          console.warn("Retrying with basic constraints", e);
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Explicitly call play
          videoRef.current.play().catch(err => {
            console.warn("Autoplay prevented, waiting for user interaction or metadata", err);
          });

          videoRef.current.onloadedmetadata = () => {
            setCameraReady(true);
          };
          
          // Robust periodic check for readiness
          checkInterval = window.setInterval(() => {
            if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.readyState >= 2) {
              setCameraReady(true);
              if (checkInterval) clearInterval(checkInterval);
            }
          }, 500);
        }
      } catch (err) {
        console.error("Camera error:", err);
        setError("Permission denied or camera not found. Please ensure you have granted camera access.");
      }
    }

    startCamera();

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (checkInterval) clearInterval(checkInterval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Memorization Timer
  useEffect(() => {
    if (phase === 'memorize' && cameraReady) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setPhase('playing');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [phase, cameraReady]);

  const spawnBlock = useCallback(() => {
    if (targetWordsSpawned.current >= targetWords.length) {
      // No more target words to spawn, but we might still spawn jumbled words 
      // until the game naturally ends or we can just end it here.
      // However, the user said "once all words covered", so we should probably 
      // stop spawning once we hit the limit.
      return;
    }

    const side = Math.random() > 0.5 ? 'left' : 'right';
    const isTarget = Math.random() > 0.3; // 70% chance for target word to keep pace
    
    let word = "";
    let finalIsTarget = isTarget;

    if (isTarget && targetWordsSpawned.current < targetWords.length) {
      word = targetWords[targetWordsSpawned.current];
      targetWordsSpawned.current++;
    } else {
      word = JUMBLED_WORDS[Math.floor(Math.random() * JUMBLED_WORDS.length)];
      finalIsTarget = false;
    }

    const newBlock: FallingBlock = {
      id: nextBlockId.current++,
      word,
      x: side === 'left' ? 50 : window.innerWidth - 170,
      y: -50,
      speed: 8 + Math.random() * 7,
      side,
      isTarget: finalIsTarget,
      status: 'active'
    };
    blocksRef.current.push(newBlock);
  }, [targetWords]);

  const handleBlink = useCallback(() => {
    if (phase !== 'playing') return;
    
    const activeBlocks = blocksRef.current.filter(b => b.status === 'active');
    if (activeBlocks.length === 0) return;

    const targets = activeBlocks.filter(b => b.isTarget);
    if (targets.length > 0) {
      targets.sort((a, b) => b.y - a.y);
      const caught = targets[0];
      caught.status = 'caught';
      setScore(s => s + 2);
      setTargetWordsProcessed(p => p + 1);
    } else {
      // Wrong word blink
      setScore(s => {
        const newScore = s - 1;
        if (newScore < 0) setPhase('gameover');
        return newScore;
      });
    }
  }, [phase]);

  const gameLoop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current || !cameraReady) {
      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    // Detection
    let results;
    try {
      results = landmarkerRef.current.detectForVideo(video, performance.now());
    } catch (err) {
      console.error("Detection error:", err);
      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }
    
    let currentlyBlinking = false;
    if (results && results.faceBlendshapes && results.faceBlendshapes.length > 0) {
      const blendshapes = results.faceBlendshapes[0].categories;
      const eyeBlinkLeft = blendshapes.find(c => c.categoryName === 'eyeBlinkLeft')?.score || 0;
      const eyeBlinkRight = blendshapes.find(c => c.categoryName === 'eyeBlinkRight')?.score || 0;
      
      if (eyeBlinkLeft > 0.4 && eyeBlinkRight > 0.4) {
        currentlyBlinking = true;
      }
    }

    if (currentlyBlinking && !isBlinking) {
      setIsBlinking(true);
      const now = performance.now();
      if (now - lastBlinkTime.current > 300) {
        lastBlinkTime.current = now;
        handleBlink();
      }
    } else if (!currentlyBlinking && isBlinking) {
      setIsBlinking(false);
    }

    // Rendering
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Camera Feed (Mirrored)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.globalAlpha = 0.2;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (phase === 'playing') {
      // Check if game should end because all words are processed
      if (targetWordsProcessed >= targetWords.length && blocksRef.current.length === 0) {
        setPhase('gameover');
      }

      // Only spawn a new block if no blocks are currently active
      if (blocksRef.current.length === 0 && targetWordsSpawned.current < targetWords.length) {
        spawnBlock();
      }

      blocksRef.current = blocksRef.current.filter(block => {
        if (block.status === 'active') {
          block.y += block.speed;
          if (block.y > canvas.height) {
            if (block.isTarget) {
              setScore(s => {
                const newScore = s - 1;
                if (newScore < 0) setPhase('gameover');
                return newScore;
              });
              setTargetWordsProcessed(p => p + 1);
            }
            return false;
          }
        } else {
          return false; 
        }

        // Draw Block
        ctx.fillStyle = '#6b7280'; 
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        
        const r = 8;
        const w = 120;
        const h = 40;
        ctx.beginPath();
        ctx.roundRect(block.x, block.y, w, h, r);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(block.word, block.x + w/2, block.y + h/1.6);
        
        return true;
      });
    }

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [cameraReady, phase, spawnBlock, isBlinking, handleBlink, targetWordsProcessed, targetWords.length]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameLoop]);

  const restartGame = () => {
    setScore(0);
    setTargetWordsProcessed(0);
    targetWordsSpawned.current = 0;
    blocksRef.current = [];
    setTimeLeft(MEMORIZATION_TIME);
    const shuffled = [...GAME_WORDS].sort(() => 0.5 - Math.random());
    setTargetWords(shuffled.slice(0, 20));
    setPhase('memorize');
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col items-center justify-center relative">
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="absolute inset-0 z-0"
      />

      <video
        ref={videoRef}
        className="hidden"
        autoPlay
        playsInline
        muted
      />

      <div className="z-10 w-full max-w-5xl px-6 pointer-events-none">
        <AnimatePresence mode="wait">
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              {!error ? (
                <>
                  <RefreshCw className="w-12 h-12 animate-spin text-blue-500" />
                  <h2 className="text-2xl font-light tracking-widest uppercase">Initializing Vision Engine</h2>
                </>
              ) : (
                <>
                  <div className="bg-red-500/20 border border-red-500/30 p-8 rounded-3xl max-w-md flex flex-col items-center gap-4">
                    <AlertCircle className="w-12 h-12 text-red-500" />
                    <h2 className="text-xl font-bold">Camera Access Required</h2>
                    <p className="text-neutral-400 text-sm leading-relaxed">{error}</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-4 bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-neutral-200 transition-colors pointer-events-auto flex items-center gap-2"
                    >
                      <RefreshCw size={18} /> Retry Access
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {phase === 'memorize' && (
            <motion.div
              key="memorize"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-neutral-900/80 backdrop-blur-xl border border-white/10 p-12 rounded-3xl shadow-2xl flex flex-col items-center gap-8 pointer-events-auto"
            >
              <div className="flex flex-col items-center gap-2">
                <h1 className="text-4xl font-bold tracking-tight">Memorize These 20 Words</h1>
                <p className="text-neutral-400">Blink your eyes when you see them falling! They won't be shown during the game.</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 w-full">
                {targetWords.map((word, i) => (
                  <motion.div
                    key={word}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-blue-600/20 border border-blue-500/30 py-3 px-4 rounded-xl text-center font-bold text-blue-400 text-sm md:text-base"
                  >
                    {word}
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-4 text-3xl font-mono">
                <Timer className="text-blue-500" />
                <span>{timeLeft}s</span>
              </div>

              <button
                onClick={() => {
                  setPhase('playing');
                  setTimeLeft(0);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold transition-all transform hover:scale-105 active:scale-95 pointer-events-auto flex items-center gap-2"
              >
                Skip & Start Game
              </button>
              
              {!cameraReady && (
                <p className="text-yellow-400 text-sm animate-pulse flex items-center gap-2">
                  <Camera size={14} /> Waiting for camera...
                </p>
              )}
            </motion.div>
          )}

          {phase === 'playing' && (
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed top-8 left-0 right-0 flex justify-between px-12 items-start"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10">
                  <Trophy className="text-yellow-500" />
                  <span className="text-2xl font-bold font-mono">{score}</span>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">
                  Progress: {targetWordsProcessed} / {targetWords.length}
                </div>
              </div>

              <div className={`flex items-center gap-3 bg-black/40 backdrop-blur-md px-6 py-3 rounded-2xl border transition-colors ${isBlinking ? 'border-blue-500 bg-blue-500/20' : 'border-white/10'}`}>
                <Eye className={isBlinking ? 'text-blue-400' : 'text-neutral-500'} />
                <span className="text-xs uppercase tracking-widest font-semibold">
                  {isBlinking ? 'Blink Detected!' : 'Watching Eyes'}
                </span>
              </div>
            </motion.div>
          )}

          {phase === 'gameover' && (
            <motion.div
              key="gameover"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-neutral-900/80 backdrop-blur-xl border border-white/10 p-12 rounded-3xl shadow-2xl flex flex-col items-center gap-8 pointer-events-auto"
            >
              <div className="flex flex-col items-center gap-2">
                <h1 className="text-4xl font-bold tracking-tight">
                  {score < 0 ? "Game Over!" : "Well Done!"}
                </h1>
                <p className="text-neutral-400">
                  {score < 0 ? "Your score hit -1." : "You've covered all the words!"}
                </p>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-6xl font-bold font-mono text-blue-500">{score}</span>
                <span className="text-xs uppercase tracking-widest text-neutral-500">Final Score</span>
              </div>

              <button
                onClick={restartGame}
                className="bg-white text-black px-12 py-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all transform hover:scale-105 flex items-center gap-3 active:scale-95"
              >
                <RefreshCw size={20} /> Start One More
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {phase === 'playing' && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-8 text-neutral-500 text-xs uppercase tracking-[0.3em] font-medium"
        >
          Blink to catch memorized words • Avoid gray blocks
        </motion.div>
      )}
    </div>
  );
}
