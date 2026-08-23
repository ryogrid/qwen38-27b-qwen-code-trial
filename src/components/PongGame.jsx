import { useEffect, useRef, useState } from "react";
import { createGame, prepareServe, drawGame, stepSim } from "../game/createGame.js";
import { setSoundEnabled } from "../game/sound.js";
import { SCREENS, W, H, WIN_SCORE } from "../game/constants.js";

const LEVELS = [
  ["easy", "EASY"],
  ["medium", "NORMAL"],
  ["hard", "HARD"],
];

export default function PongGame() {
  const canvasRef = useRef(null);
  // StrictMode の二重呼び出しに備え、シミュレーションは最初の描画時に一度だけ生成する
  const gameRef = useRef(null);
  if (!gameRef.current) gameRef.current = createGame();

  const [screen, setScreen] = useState(SCREENS.MENU);
  const [scores, setScores] = useState({ player: 0, ai: 0 });
  const [difficulty, setDifficulty] = useState("medium");
  const [soundOn, setSoundOn] = useState(true);

  // ロジックの権威は scoresRef（副作用なしで同期更新）。
  // ミラー ref は毎レンダリングで同期し、一度だけマウントされる effect が古い値を見ないよう担保する。
  const scoresRef = useRef(scores);
  const screenRef = useRef(screen);
  const difficultyRef = useRef(difficulty);
  const soundOnRef = useRef(soundOn);
  screenRef.current = screen;
  difficultyRef.current = difficulty;
  soundOnRef.current = soundOn;

  // ゲーム開始（元実装の startGame と同一の手順）
  function startGame() {
    const g = gameRef.current;
    scoresRef.current = { player: 0, ai: 0 };
    setScores({ player: 0, ai: 0 });
    g.player.y = H / 2;
    g.ai.y = H / 2;
    g.useMouseFollow = true;
    prepareServe(g); // dir なし → ランダム方向でサーブ準備
    setScreen(SCREENS.PLAYING);
  }

  function togglePause() {
    if (screenRef.current === SCREENS.PLAYING) setScreen(SCREENS.PAUSED);
    else if (screenRef.current === SCREENS.PAUSED) setScreen(SCREENS.PLAYING);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const game = gameRef.current;

    // 初回は current=0 → stepSim 内 `lastTimeRef.current || now` で dt=0（元実装の初フレーム挙動と同一）
    const lastTime = { current: 0 };
    let rafId;

    // ポイント処理：stepGame の戻り値で判定（勝敗・次のサーブもここで制御）
    function handlePoint(side) {
      const s = scoresRef.current;
      const next = { ...s, [side]: s[side] + 1 };
      scoresRef.current = next;
      setScores(next);
      if (next[side] >= WIN_SCORE) {
        setScreen(SCREENS.GAMEOVER);
      } else {
        prepareServe(game, side === "player" ? 1 : -1);
      }
    }

    // ---- キーボード（元の script.js と同一の分岐）----
    function onKeyDown(e) {
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          game.keys.up = true;
          game.useMouseFollow = false;
          break;
        case "ArrowDown":
        case "s":
        case "S":
          game.keys.down = true;
          game.useMouseFollow = false;
          break;
        case "p":
        case "P":
        case "Escape":
          togglePause();
          break;
        case "m":
        case "M": {
          const next = !soundOnRef.current;
          setSoundEnabled(next);
          soundOnRef.current = next;
          setSoundOn(next);
          break;
        }
        case "Enter":
          // 元実装: メニュー/ゲームオーバーで開始、ポーズ中のみ再開（プレイ中は無効）
          if (screenRef.current === SCREENS.MENU || screenRef.current === SCREENS.GAMEOVER) {
            startGame();
          } else if (screenRef.current === SCREENS.PAUSED) {
            togglePause();
          }
          break;
      }
    }

    function onKeyUp(e) {
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          game.keys.up = false;
          break;
        case "ArrowDown":
        case "s":
        case "S":
          game.keys.down = false;
          break;
      }
    }

    // ---- マウス（元の canvas mousemove と同一の計算式）----
    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      game.mouseY = ((e.clientY - rect.top) / rect.height) * H;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousemove", onMouseMove);

    // ---- メインループ（元実装の frame() をそのまま反映）----
    function frame(now) {
      rafId = requestAnimationFrame(frame);
      if (screenRef.current === SCREENS.PLAYING) {
        const side = stepSim(game, difficultyRef.current, now, lastTime);
        if (side) handlePoint(side);
      } else {
        // 非プレイ中はステップしないが時刻は最新に保つ（元実装: lastTime は毎フレーム更新）
        lastTime.current = now;
      }
      drawGame(ctx, game);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousemove", onMouseMove);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectLevel(level) {
    setDifficulty(level);
  }

  const inMenu = screen === SCREENS.MENU;
  const inGameover = screen === SCREENS.GAMEOVER;

  return (
    <main className="stage">
      <div className="game-wrap">
        <header className="scoreboard" aria-live="polite">
          <span className="player-score">{scores.player}</span>
          <span className="score-label">PONG</span>
          <span className="ai-score">{scores.ai}</span>
        </header>

        <canvas ref={canvasRef} width={W} height={H}></canvas>

        <section className={"overlay" + (inMenu ? " visible" : "")}>
          <h1>PONG</h1>
          <p className="sub">1P vs CPU</p>
          <div className="difficulty">
            <span>難易度</span>
            {LEVELS.map(([value, label]) => (
              <button
                key={value}
                data-level={value}
                className={difficulty === value ? "selected" : ""}
                onClick={() => selectLevel(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="menu-msg">まずは 5 ポイントで勝利</p>
          <button className="start-btn" onClick={startGame}>
            START (Enter)
          </button>
        </section>

        <section className={"overlay center-only" + (screen === SCREENS.PAUSED ? " visible" : "")}>
          <h2>PAUSE</h2>
          <p>P / Esc で再開</p>
        </section>

        <section className={"overlay center-only" + (inGameover ? " visible" : "")}>
          <h2>{scores.player > scores.ai ? "YOU WIN!" : "CPU WINS!"}</h2>
          <p>
            {scores.player} - {scores.ai}
          </p>
          <button className="restart-btn" onClick={startGame}>
            RESTART (Enter)
          </button>
        </section>

        <footer className="help">
          <span>&#8593;/&#8595; や W/S で移動</span>
          <i>|</i>
          <span>マウスもOK</span>
          <i>|</i>
          <span>P: パーズ</span>
          <i>|</i>
          <span>M: サウンドON/OFF</span>
        </footer>
      </div>
    </main>
  );
}
