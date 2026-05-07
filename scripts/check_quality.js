
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('exercises_with_images.json', 'utf8'));
const realNames = data.filter(ex => !ex.name.startsWith('Exercise '));
console.log(`Total: ${data.length}`);
console.log(`Real names: ${realNames.length}`);
if (realNames.length > 0) {
    console.log('Sample real names:');
    realNames.slice(0, 5).forEach(ex => console.log(`- ${ex.name}`));
}
