import fs from 'fs';
import path from 'path';

const JSON_INPUT = path.join(process.cwd(), 'exercises_with_images.json');
const OUTPUT_FILE = path.join(process.cwd(), 'src', 'constants.ts');

if (!fs.existsSync(JSON_INPUT)) {
  console.error("No exercises_with_images.json found!");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(JSON_INPUT, 'utf8'));

const exercisesList = data.map(ex => ({
  id: ex.id,
  name: ex.name,
  muscle: ex.muscles[0] || "Other",
  category: ex.category || "Other",
  equipment: ex.equipment[0] || "None",
  image: ex.images.main[0] || (ex.images.secondary && ex.images.secondary[0]) || "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=100&h=100&fit=crop"
}));

const tsContent = `import { ExerciseDefinition } from "./types";

export const EXERCISES: ExerciseDefinition[] = ${JSON.stringify(exercisesList, null, 2)};
`;

fs.writeFileSync(OUTPUT_FILE, tsContent);
console.log(`Updated ${OUTPUT_FILE} with ${exercisesList.length} wger exercises.`);
