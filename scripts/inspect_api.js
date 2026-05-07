
async function inspect() {
  const exRes = await fetch('https://wger.de/api/v2/exerciseinfo/?limit=1');
  const exData = await exRes.json();
  console.log('ExerciseInfo object keys:', Object.keys(exData.results[0]));
  console.log('ExerciseInfo object sample:', JSON.stringify(exData.results[0], null, 2));

  const imgRes = await fetch('https://wger.de/api/v2/exerciseimage/?limit=1');
  const imgData = await imgRes.json();
  console.log('Image object keys:', Object.keys(imgData.results[0]));
}
inspect();
