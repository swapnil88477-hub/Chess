import {
  HandLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

// ─── CHESS PIECE UNICODE MAPPER ──────────────────────────────────────────────
const PIECE_EMOJIS = {
  'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚', // Black
  'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'  // White
};

// ─── CONFIGURATION & STATE ───────────────────────────────────────────────────
let gameMode = 'pvp';
let difficulty = 'easy';
const HOVER_SPEED = 6.0;

const video = document.getElementById('webcam');
const handCanvas = document.getElementById('hand-canvas');
const handCtx = handCanvas.getContext('2d');
const boardEl = document.getElementById('chess-board');

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameOverScreen = document.getElementById('game-over');
const loadingScreen = document.getElementById('loading');
const containerEl = document.getElementById('game-container');

const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');
const exitBtn = document.getElementById('exit-btn');
const pauseBtn = document.getElementById('pause-btn');
const goRestartBtn = document.getElementById('gameover-restart-btn');
const goExitBtn = document.getElementById('gameover-exit-btn');

const turnBox = document.getElementById('turn-box');
const logEntries = document.getElementById('log-entries');
const winStatus = document.getElementById('win-status');
const winDetails = document.getElementById('win-details');

let W, H;
let handLandmarker = null;
let lastVideoTime = -1;
let activeMatch = null; 
let gameActive = false;
let gamePaused = false;

let cursorIndex = null;
let selectedSquare = null; 
let validMovesForSelected = [];
let activeHoverTarget = null;
let hoverProgress = 0;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  handCanvas.width = W;
  handCanvas.height = H;
}
window.addEventListener('resize', resize);
resize();

// ─── AI COMPUTER LOGIC ───────────────────────────────────────────────────────
function getComputerMove() {
  const moves = activeMatch.moves({ verbose: true });
  if (moves.length === 0) return;

  let move;
  if (difficulty === 'easy') {
    move = moves[Math.floor(Math.random() * moves.length)];
  } else if (difficulty === 'medium') {
    move = moves.find(m => m.flags.includes('c')) || moves[Math.floor(Math.random() * moves.length)];
  } else {
    move = moves.find(m => m.flags.includes('c')) || moves.find(m => m.flags.includes('k')) || moves[0];
  }
  
  activeMatch.move(move);
  generateVisualBoard();
  checkMatchEndConditions();
  turnBox.textContent = "White's Turn";
}

// ─── INITIALIZATION ──────────────────────────────────────────────────────────
async function initHandtracking() {
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numHands: 1,
  });
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  await video.play();
}

// ─── BOARD ENGINE GENERATION ────────────────────────────────────────────────
function generateVisualBoard() {
  boardEl.innerHTML = '';
  const boardLayout = activeMatch.board();
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      const squareName = files[c] + (8 - r);
      cell.classList.add('cell', (r + c) % 2 === 0 ? 'light' : 'dark');
      cell.dataset.square = squareName;

      const metadata = boardLayout[r][c];
      if (metadata) {
        const isWhite = metadata.color === 'w';
        const key = isWhite ? metadata.type.toUpperCase() : metadata.type.toLowerCase();
        
        cell.textContent = PIECE_EMOJIS[key] || '';
        cell.classList.add(isWhite ? 'white-piece' : 'black-piece');
      }

      const prog = document.createElement('div');
      prog.classList.add('cell-progress');
      cell.appendChild(prog);

      if (selectedSquare === squareName) cell.classList.add('selected');
      if (validMovesForSelected.includes(squareName)) cell.classList.add('valid-move');
      boardEl.appendChild(cell);
    }
  }
}

// ─── GESTURE & INTERACTION ENGINE ────────────────────────────────────────────
function detectGestures() {
  if (!handLandmarker || video.readyState < 2) return;
  const timestamp = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const observations = handLandmarker.detectForVideo(video, timestamp);
  handCtx.clearRect(0, 0, W, H);

  if (observations.landmarks && observations.landmarks.length > 0) {
    const indexTip = observations.landmarks[0][8];
    const ix = (1 - indexTip.x) * W;
    const iy = indexTip.y * H;
    cursorIndex = { x: ix, y: iy };

    gamePaused || !gameActive ? handleMenuHoverEngine(ix, iy) : handleBoardHoverEngine(ix, iy);
    drawTrackingGlow();
  } else {
    cursorIndex = null;
    clearInteractiveTrackingEffects();
  }
}

function handleBoardHoverEngine(x, y) {
  const sidebarBtn = document.querySelector('.sidebar .gesture-target');
  if(sidebarBtn) {
    const btnBox = sidebarBtn.getBoundingClientRect();
    if (x >= btnBox.left && x <= btnBox.right && y >= btnBox.top && y <= btnBox.bottom) {
      handleMenuHoverEngine(x, y);
      return;
    }
  }

  const target = document.elementFromPoint(x, y);
  const cell = target ? target.closest('.cell') : null;

  document.querySelectorAll('.cell').forEach(c => {
    c.classList.remove('hovered-square');
    if (c !== cell) c.querySelector('.cell-progress').style.width = '0%';
  });

  if (cell) {
    cell.classList.add('hovered-square');
    if (activeHoverTarget === cell) {
      hoverProgress += HOVER_SPEED; 
      cell.querySelector('.cell-progress').style.width = `${Math.min(hoverProgress, 100)}%`;
      if (hoverProgress >= 100) {
        processSquareSelection(cell.dataset.square);
        clearInteractiveTrackingEffects();
      }
    } else {
      clearInteractiveTrackingEffects();
      activeHoverTarget = cell;
    }
  } else { clearInteractiveTrackingEffects(); }
}

function handleMenuHoverEngine(x, y) {
  const actions = document.querySelectorAll('.overlay:not(.hidden) .gesture-target, .sidebar .gesture-target');
  let targeted = null;
  actions.forEach(btn => {
    const box = btn.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) targeted = btn;
  });

  if (targeted) {
    if (activeHoverTarget === targeted) {
      hoverProgress += HOVER_SPEED;
      const bar = targeted.querySelector('.progress-bar');
      if (bar) bar.style.width = `${Math.min(hoverProgress, 100)}%`;
      if (hoverProgress >= 100) { targeted.click(); clearInteractiveTrackingEffects(); }
    } else { clearInteractiveTrackingEffects(); activeHoverTarget = targeted; targeted.classList.add('hovered'); }
  } else { clearInteractiveTrackingEffects(); }
}

function clearInteractiveTrackingEffects() {
  document.querySelectorAll('.gesture-target').forEach(btn => {
    btn.classList.remove('hovered');
    const bar = btn.querySelector('.progress-bar');
    if (bar) bar.style.width = '0%';
  });
  activeHoverTarget = null;
  hoverProgress = 0;
}

function processSquareSelection(square) {
  const piece = activeMatch.get(square);
  if (selectedSquare && validMovesForSelected.includes(square)) {
    executeChessMove(selectedSquare, square);
  } else if (piece && piece.color === activeMatch.turn()) {
    selectedSquare = square;
    validMovesForSelected = activeMatch.moves({ square: square, verbose: true }).map(m => m.to);
    generateVisualBoard();
  } else { cancelSelection(); }
}

function cancelSelection() { selectedSquare = null; validMovesForSelected = []; generateVisualBoard(); }

// ─── GAME LOGIC ──────────────────────────────────────────────────────────────
function executeChessMove(from, to) {
  const moveResult = activeMatch.move({ from: from, to: to, promotion: 'q' });
  if (moveResult) {
    const turnName = activeMatch.turn() === 'w' ? "White's Turn" : "Black's Turn";
    turnBox.textContent = turnName;
    const item = document.createElement('div');
    item.textContent = `${moveResult.color.toUpperCase()}: ${moveResult.from} ➔ ${moveResult.to}`;
    logEntries.appendChild(item);
    logEntries.scrollTop = logEntries.scrollHeight;

    cancelSelection();
    checkMatchEndConditions();

    if (gameMode === 'pvc' && activeMatch.turn() === 'b' && !activeMatch.game_over()) {
      setTimeout(getComputerMove, 400);
    }
  }
}

function checkMatchEndConditions() {
  if (activeMatch.in_checkmate()) endGame("Checkmate!", `${activeMatch.turn() === 'w' ? 'Black' : 'White'} won.`);
  else if (activeMatch.in_draw() || activeMatch.in_stalemate()) endGame("Match Drawn", "The game ended in a draw.");
}

function drawTrackingGlow() {
  if (!cursorIndex) return;
  handCtx.fillStyle = '#fff';
  handCtx.shadowColor = '#8a2be2';
  handCtx.shadowBlur = 15;
  handCtx.beginPath();
  handCtx.arc(cursorIndex.x, cursorIndex.y, 8, 0, Math.PI * 2);
  handCtx.fill();
  handCtx.shadowBlur = 0;
}

function startNewMatch() {
  activeMatch = new Chess();
  selectedSquare = null;
  validMovesForSelected = [];
  logEntries.innerHTML = '';
  turnBox.textContent = "White's Turn";
  gameActive = true;
  gamePaused = false;
  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  containerEl.classList.remove('hidden');
  generateVisualBoard();
}

function togglePauseState() {
  if (!gameActive) return;
  gamePaused = !gamePaused;
  clearInteractiveTrackingEffects();
  pauseScreen.classList.toggle('hidden', !gamePaused);
}

function dropToMainMenu() {
  gameActive = false;
  gamePaused = false;
  containerEl.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

function endGame(title, text) {
  gameActive = false;
  winStatus.textContent = title;
  winDetails.textContent = text;
  gameOverScreen.classList.remove('hidden');
}

function engineLoop() {
  detectGestures();
  requestAnimationFrame(engineLoop);
}

startBtn.addEventListener('click', async () => {
  gameMode = document.getElementById('mode-select').value;
  difficulty = document.getElementById('diff-select').value;
  startBtn.disabled = true;
  loadingScreen.classList.remove('hidden');
  try {
    await startCamera();
    await initHandtracking();
    loadingScreen.classList.add('hidden');
    startNewMatch();
    engineLoop();
  } catch (err) {
    loadingScreen.classList.add('hidden');
    alert('Webcam authorization failed.');
    startBtn.disabled = false;
  }
});

resumeBtn.addEventListener('click', togglePauseState);
restartBtn.addEventListener('click', startNewMatch);
exitBtn.addEventListener('click', dropToMainMenu);
pauseBtn.addEventListener('click', togglePauseState);
goRestartBtn.addEventListener('click', startNewMatch);
goExitBtn.addEventListener('click', dropToMainMenu);