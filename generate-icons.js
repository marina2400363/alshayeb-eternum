const sharp = require('sharp');
const fs = require('fs');

async function generate() {
  await sharp('public/favicon.svg').resize(48, 48).toFile('public/favicon.ico');
  console.log('favicon.ico created');
  
  await sharp('public/favicon.svg').resize(192, 192).toFile('public/logo192.png');
  console.log('192 created');
  
  await sharp('public/favicon.svg').resize(512, 512).toFile('public/logo512.png');
  console.log('512 created');
}

generate();
