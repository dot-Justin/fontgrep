// Per-letter unicode style variants for "fontgrepping"
const V: Record<string, string[]> = {
  f: ['𝐟','𝑓','𝒇','𝓯','𝔣','𝖋','𝕗','𝖿','𝗳','𝘧','𝙛','𝚏','ｆ','ⓕ','ᶠ','ꜰ','ƒ','ϝ'],
  o: ['𝐨','𝑜','𝒐','𝓸','𝔬','𝖔','𝕠','𝗈','𝗼','𝘰','𝙤','𝚘','ｏ','ⓞ','ᵒ','ᴏ','ø','ο'],
  n: ['𝐧','𝑛','𝒏','𝓷','𝔫','𝖓','𝕟','𝗇','𝗻','𝘯','𝙣','𝚗','ｎ','ⓝ','ⁿ','ɴ','η','ñ'],
  t: ['𝐭','𝑡','𝒕','𝓽','𝔱','𝖙','𝕥','𝗍','𝘁','𝘵','𝙩','𝚝','ｔ','ⓣ','ᵗ','ᴛ','τ','ŧ'],
  g: ['𝐠','𝑔','𝒈','𝓰','𝔤','𝖌','𝕘','𝗀','𝗴','𝘨','𝙜','𝚐','ｇ','ⓖ','ᵍ','ɢ','ġ','ℊ'],
  r: ['𝐫','𝑟','𝒓','𝓻','𝔯','𝖗','𝕣','𝗋','𝗿','𝘳','𝙧','𝚛','ｒ','ⓡ','ʳ','ʀ','ŗ','ř'],
  e: ['𝐞','𝑒','𝒆','𝓮','𝔢','𝖊','𝕖','𝖾','𝗲','𝘦','𝙚','𝚎','ｅ','ⓔ','ᵉ','ᴇ','ε','ë'],
  p: ['𝐩','𝑝','𝒑','𝓹','𝔭','𝖕','𝕡','𝗉','𝗽','𝘱','𝙥','𝚙','ｐ','ⓟ','ᵖ','ᴘ','ρ','þ'],
  i: ['𝐢','𝑖','𝒊','𝓲','𝔦','𝖎','𝕚','𝗂','𝗶','𝘪','𝙞','𝚒','ｉ','ⓘ','ⁱ','ɪ','ι','ï'],
};

const WORD = 'fontgrepping';
const FRAME_MS = 45;
const INITIAL_CHAOS_MS = 150;
const SETTLE_STAGGER_MS = 80;
const SETTLE_DURATION_MS = 620;

function rand(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function startBanner(query: string): () => void {
  if (!process.stdout.isTTY) return () => {};

  const letters = WORD.split('');
  const suffix = ` for ${query}`;
  const start = Date.now();
  const totalDuration =
    INITIAL_CHAOS_MS +
    (letters.length - 1) * SETTLE_STAGGER_MS +
    SETTLE_DURATION_MS;

  process.stdout.write('\x1b[?25l'); // hide cursor

  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const frame = (): void => {
    const elapsed = Date.now() - start;

    let out = '';
    letters.forEach((letter, i) => {
      const settleStart = INITIAL_CHAOS_MS + i * SETTLE_STAGGER_MS;
      const progress = Math.min(1, Math.max(0, (elapsed - settleStart) / SETTLE_DURATION_MS));

      if (progress >= 1) {
        out += letter;
      } else {
        const changeProb = Math.pow(1 - progress, 3);
        out += Math.random() < changeProb ? rand(V[letter]) : letter;
      }
    });

    process.stdout.write(`\x1b[2K\r  ${out}${suffix}`);

    if (elapsed >= totalDuration) {
      settled = true;
      return;
    }
    timer = setTimeout(frame, FRAME_MS);
  };

  const onExit = () => process.stdout.write('\x1b[?25h');
  const onSigint = () => { onExit(); process.exit(130); };
  process.once('exit', onExit);
  process.once('SIGINT', onSigint);

  frame();

  return () => {
    if (timer) clearTimeout(timer);
    process.off('exit', onExit);
    process.off('SIGINT', onSigint);
    process.stdout.write('\x1b[?25h\x1b[2K\r'); // restore cursor, clear line
  };
}
