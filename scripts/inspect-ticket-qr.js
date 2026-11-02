// Browser-test helper: decode a rendered PDF's RGBA pixels with an independent QR reader.
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
const [file,widthValue,heightValue]=process.argv.slice(2);
const width=Number(widthValue),height=Number(heightValue);
if(!file||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Supply an RGBA file, width and height.');
const data=await readFile(file);
if(data.length!==width*height*4)throw new Error('Invalid RGBA dimensions.');
const result=jsQR(new Uint8ClampedArray(data),width,height,{inversionAttempts:'dontInvert'});
if(!result)throw new Error('No readable QR code found in the rendered PDF.');
console.log(result.data);
