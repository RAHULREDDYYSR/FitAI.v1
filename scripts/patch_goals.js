import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// ─────────────────────────────────────────────────────────
// FIND the old Vision & Goal card block
// ─────────────────────────────────────────────────────────
const OLD_BLOCK_START = `        <div className="bg-[#1A1A1A] p-6 rounded-3xl border border-zinc-800 space-y-4">`;
const OLD_BLOCK_END_AFTER = `        </div>\n\n        <div className="bg-[#101010]`;

let si = content.indexOf(OLD_BLOCK_START);
if (si === -1) {
  // Try with \r\n
  const alt = OLD_BLOCK_START.replace(/\n/g, '\r\n');
  si = content.indexOf(alt);
}

if (si === -1) {
  // Search for unique anchor
  si = content.indexOf('My Vision');
  if (si !== -1) {
    // Walk back to start of containing div
    si = content.lastIndexOf('        <div', si);
  }
}

if (si === -1) {
  console.error('START not found');
  process.exit(1);
}

// Find the end: the closing </div> that precedes bg-[#101010]
let endSearch = content.indexOf('bg-[#101010]', si);
if (endSearch === -1) { console.error('END not found'); process.exit(1); }
// Walk back to the closing </div>
let ei = content.lastIndexOf('</div>', endSearch);
// We want to keep the newlines before bg-[#101010], so cut after the </div>
ei = ei + '</div>'.length;

console.log(`Replacing chars ${si} to ${ei}`);
console.log('Old snippet (first 100):', JSON.stringify(content.slice(si, si + 100)));

const NEW_BLOCK = `        <div className="bg-[#1A1A1A] p-6 rounded-3xl border border-zinc-800 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">My Vision &amp; Goals</h3>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] animate-pulse" />
              <p className="text-[9px] text-zinc-500 uppercase font-mono tracking-wider">AI Coaching Active</p>
            </div>
          </div>

          {/* Short-term Goal */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">
                Short-term <span className="normal-case text-zinc-700 font-normal">(next few months)</span>
              </p>
              <button
                disabled={isRefiningShort}
                onClick={async () => {
                  const aim = profile?.aim || profile?.shortTermGoal || '';
                  if (!aim) { alert("Add your aim or short-term goal first."); return; }
                  setIsRefiningShort(true);
                  try {
                    const m = new ChatOpenAI({ modelName: "gpt-4o-mini", openAIApiKey: process.env.OPENAI_API_KEY, configuration: { dangerouslyAllowBrowser: true } });
                    const res = await m.invoke(\`You are an elite fitness coach. Distill the user's aim into a sharp SHORT-TERM goal (next 2-4 months). Under 12 words, action-oriented, specific.\\nUser aim: "\${aim}"\\nCurrent short goal: "\${profile?.shortTermGoal || 'None'}"\\nRefined Short-term Goal (only the goal text, no quotes):\`);
                    onUpdate({ shortTermGoal: res.content.toString().trim().replace(/^"|"$/g, '') });
                  } catch (e) { alert(\`AI Refine failed: \${e.message}\`); }
                  finally { setIsRefiningShort(false); }
                }}
                className={cn("p-1.5 rounded-lg border transition-all flex items-center space-x-1",
                  isRefiningShort ? "border-[#CCFF00]/50 text-[#CCFF00] animate-pulse" : "border-zinc-800 text-zinc-500 hover:text-[#CCFF00] hover:border-[#CCFF00]/40"
                )}
                title="Refine short-term goal with AI"
              >
                {isRefiningShort ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span className="text-[9px] font-mono uppercase tracking-wider">Refine</span>
              </button>
            </div>
            {isEditing ? (
              <input
                className="bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-xl w-full text-white focus:border-[#CCFF00]/50 outline-none transition-colors text-sm"
                value={profile?.shortTermGoal || ''}
                placeholder="e.g. Gain 5kg lean muscle by August"
                onChange={(e) => onUpdate({ shortTermGoal: e.target.value })}
              />
            ) : (
              <p className="text-lg font-bold">{profile?.shortTermGoal || <span className="text-zinc-600 font-normal italic text-sm">No short-term goal set yet</span>}</p>
            )}
          </div>

          {/* Long-term Goal */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">
                Long-term <span className="normal-case text-zinc-700 font-normal">(1 year+)</span>
              </p>
              <button
                disabled={isRefiningLong}
                onClick={async () => {
                  const aim = profile?.aim || profile?.longTermGoal || '';
                  if (!aim) { alert("Add your aim or long-term goal first."); return; }
                  setIsRefiningLong(true);
                  try {
                    const m = new ChatOpenAI({ modelName: "gpt-4o-mini", openAIApiKey: process.env.OPENAI_API_KEY, configuration: { dangerouslyAllowBrowser: true } });
                    const res = await m.invoke(\`You are an elite fitness coach. Craft an ambitious LONG-TERM goal (1+ years). Under 15 words, visionary, specific milestone.\\nUser aim: "\${aim}"\\nShort-term: "\${profile?.shortTermGoal || 'None'}"\\nCurrent long goal: "\${profile?.longTermGoal || 'None'}"\\nRefined Long-term Goal (only the goal text, no quotes):\`);
                    onUpdate({ longTermGoal: res.content.toString().trim().replace(/^"|"$/g, '') });
                  } catch (e) { alert(\`AI Refine failed: \${e.message}\`); }
                  finally { setIsRefiningLong(false); }
                }}
                className={cn("p-1.5 rounded-lg border transition-all flex items-center space-x-1",
                  isRefiningLong ? "border-[#CCFF00]/50 text-[#CCFF00] animate-pulse" : "border-zinc-800 text-zinc-500 hover:text-[#CCFF00] hover:border-[#CCFF00]/40"
                )}
                title="Refine long-term goal with AI"
              >
                {isRefiningLong ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span className="text-[9px] font-mono uppercase tracking-wider">Refine</span>
              </button>
            </div>
            {isEditing ? (
              <input
                className="bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-xl w-full text-white focus:border-[#CCFF00]/50 outline-none transition-colors text-sm"
                value={profile?.longTermGoal || ''}
                placeholder="e.g. Compete in Men's Physique by 2026"
                onChange={(e) => onUpdate({ longTermGoal: e.target.value })}
              />
            ) : (
              <p className="text-base font-semibold text-zinc-200">{profile?.longTermGoal || <span className="text-zinc-600 font-normal italic text-sm">No long-term goal set yet</span>}</p>
            )}
          </div>

          {/* Detailed Aim */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">Detailed Aim &amp; Vision</p>
            {isEditing ? (
              <textarea
                className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-xl w-full text-white text-xs resize-none h-20 focus:border-[#CCFF00]/50 outline-none transition-colors"
                value={profile?.aim || ''}
                placeholder="Describe what you want to achieve, your motivation, and your ultimate vision..."
                onChange={(e) => onUpdate({ aim: e.target.value })}
              />
            ) : (
              <p className="text-sm text-zinc-400 italic">"{profile?.aim || 'Describe your vision here...'}"</p>
            )}
          </div>
        </div>`;

const newContent = content.slice(0, si) + NEW_BLOCK + content.slice(ei);
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Done. New content length:', newContent.length);
