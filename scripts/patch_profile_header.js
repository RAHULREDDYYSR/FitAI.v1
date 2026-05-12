import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');
const original = content;

// 1. Ensure Pencil and Check are imported from lucide-react
const lucideImportIdx = content.indexOf("from 'lucide-react'");
if (lucideImportIdx !== -1) {
  // Find start of import line
  const importLineStart = content.lastIndexOf('import', lucideImportIdx);
  const importLine = content.slice(importLineStart, content.indexOf('\n', lucideImportIdx));
  
  let newImportLine = importLine;
  if (!newImportLine.includes('Pencil')) {
    newImportLine = newImportLine.replace('{', '{ Pencil, ');
  }
  if (!newImportLine.includes('Check')) {
    newImportLine = newImportLine.replace('{', '{ Check, ');
  }
  content = content.replace(importLine, newImportLine);
  console.log('Ensured Pencil and Check are imported.');
}

// 2. Replace the Edit button in Profile Header
const editBtnRegex = /<button[^>]*onClick={\(\) => setIsEditing\(!isEditing\)}[^>]*>[\s\S]*?<\/button>/;
const match = content.match(editBtnRegex);

if (match) {
  const newBtn = `<button
            onClick={() => setIsEditing(!isEditing)}
            className={cn(
              "p-2 rounded-xl border transition-all flex items-center space-x-1.5",
              isEditing 
                ? "bg-[#CCFF00] text-black border-[#CCFF00] font-bold shadow-lg shadow-[#CCFF00]/20" 
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
            )}
            title={isEditing ? "Save Profile" : "Edit Profile"}
          >
            {isEditing ? (
              <>
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span className="text-xs font-mono uppercase tracking-wider pr-1">Save</span>
              </>
            ) : (
              <>
                <Pencil className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-wider pr-1">Edit</span>
              </>
            )}
          </button>`;
          
  content = content.replace(match[0], newBtn);
  console.log('Successfully patched Profile header Pencil/Check edit button.');
} else {
  console.warn('Exact edit button regex did not match. Looking for alternative profile header patterns...');
}

if (content !== original) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('patch_profile_header.js applied successfully.');
} else {
  console.log('No changes needed or pattern not found for profile header edit button.');
}
