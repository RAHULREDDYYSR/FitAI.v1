import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'assets', 'exercises');
const JSON_OUTPUT = path.join(process.cwd(), 'exercises_with_images.json');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAll(url) {
  let results = [];
  let nextUrl = url;
  while (nextUrl) {
    console.log(`Fetching: ${nextUrl}`);
    const res = await fetch(nextUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${nextUrl}: ${res.statusText}`);
    const data = await res.json();
    results = results.concat(data.results);
    nextUrl = data.next;
    await delay(300);
  }
  return results;
}

async function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`Failed to download image: ${res.statusCode}`));
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    console.log("Fetching exercise info...");
    // ExerciseInfo contains all translations and categories/muscles embedded
    const allExerciseInfo = await fetchAll('https://wger.de/api/v2/exerciseinfo/?limit=50&offset=0');
    console.log(`Found ${allExerciseInfo.length} total exercise info groups.`);

    const englishMap = new Map(); // Map specific exercise ID to our processed object

    for (const info of allExerciseInfo) {
      const englishTranslation = info.translations.find(t => t.language === 2);
      if (!englishTranslation) continue;

      const processed = {
        id: `wger-${englishTranslation.id}`,
        name: englishTranslation.name,
        category: info.category?.name || "Other",
        muscles: info.muscles.map(m => m.name_en || m.name).concat(info.muscles_secondary.map(m => m.name_en || m.name)).filter(Boolean),
        equipment: info.equipment.map(e => e.name).filter(Boolean),
        images: { main: [], secondary: [] }
      };

      // Map by the specific exercise ID that images link to
      englishMap.set(englishTranslation.id, processed);
      
      // Also map by other translations if we want to catch images linked to non-English versions
      for (const t of info.translations) {
        if (t.id !== englishTranslation.id) {
          // Point to the same processed object (which has the English name)
          englishMap.set(t.id, processed);
        }
      }
    }

    console.log(`Mapped ${englishMap.size} translation IDs to English exercises.`);

    console.log("Fetching exercise images...");
    const allImages = await fetchAll('https://wger.de/api/v2/exerciseimage/');
    console.log(`Found ${allImages.length} images.`);

    const finalExercises = new Map();

    const downloadWithRetry = async (url, dest, attempts = 2) => {
      if (fs.existsSync(dest)) return true;
      for (let i = 0; i < attempts; i++) {
        try {
          await downloadImage(url, dest);
          return true;
        } catch (e) {
          if (i === attempts - 1) throw e;
          await delay(300);
        }
      }
    };

    for (const img of allImages) {
      const ex = englishMap.get(img.exercise);
      if (!ex) continue;

      const baseExId = ex.id.replace('wger-', '');
      const isMain = img.is_main;
      const index = isMain ? ex.images.main.length : ex.images.secondary.length;
      
      const filename = `${baseExId}_${isMain ? 'main' : 'secondary'}${index > 0 ? '_' + index : ''}.png`;
      const localPath = `/assets/exercises/${filename}`;
      const dest = path.join(OUTPUT_DIR, filename);

      console.log(`Downloading image for ${ex.name}: ${img.image}`);
      try {
        const success = await downloadWithRetry(img.image, dest);
        if (success) {
          if (isMain) ex.images.main.push(localPath);
          else ex.images.secondary.push(localPath);
          
          finalExercises.set(ex.id, ex);
          // Incremental save
          fs.writeFileSync(JSON_OUTPUT, JSON.stringify(Array.from(finalExercises.values()), null, 2));
        }
      } catch (err) {
        console.error(`Failed to download ${img.image}:`, err.message);
      }
      await delay(300);
    }

    console.log(`Success! Saved ${finalExercises.size} exercises with images to ${JSON_OUTPUT}`);

  } catch (err) {
    console.error("Critical Error:", err);
    process.exit(1);
  }
}

main();
