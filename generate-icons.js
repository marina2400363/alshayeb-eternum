const sharp = require('sharp');
const fs = require('fs');

async function generate() {
  const input = 'references/alshayeb_spade_filled_navy.png';
  
  // Trim removes transparent padding.
  // We use fit 'contain' with a transparent background to preserve aspect ratio without black bars.
  const bg = { r: 0, g: 0, b: 0, alpha: 0 };
  
  await sharp(input).trim().resize(48, 48, { fit: 'contain', background: bg }).toFile('public/favicon.ico');
  console.log('favicon.ico created');
  
  await sharp(input).trim().resize(192, 192, { fit: 'contain', background: bg }).toFile('public/logo192.png');
  console.log('192 created');
  
  await sharp(input).trim().resize(512, 512, { fit: 'contain', background: bg }).toFile('public/logo512.png');
  console.log('512 created');
}

generate();
