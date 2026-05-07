import fs from 'fs';
import path from 'path';

const CONSTANTS_FILE = path.join(process.cwd(), 'src', 'constants.ts');
let content = fs.readFileSync(CONSTANTS_FILE, 'utf8');

// Use regex to remove image fields
content = content.replace(/,\s+"image":\s+".*"/g, '');
// For cases where it's not followed by a comma (last property)
content = content.replace(/"image":\s+".*",?/g, '');

fs.writeFileSync(CONSTANTS_FILE, content);
console.log('Images removed from src/constants.ts');
