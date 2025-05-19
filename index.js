const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket } = require('mongodb');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

const MONGO_URI = 'mongodb+srv://toxiciter:Hasan5&7@toxiciter.9tkfu.mongodb.net/STORAGE?retryWrites=true&w=majority&appName=Toxiciter';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const conn = mongoose.connection;
let gridfsBucket;


const tempDir = path.join(__dirname, 'temp');
const localFolder = path.join(__dirname, 'File');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(localFolder)) fs.mkdirSync(localFolder);


const upload = multer({ dest: tempDir });


function saveToLocal(filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(localFolder, filename);
    const downloadStream = gridfsBucket.openDownloadStreamByName(filename);
    const writeStream = fs.createWriteStream(filePath);

    downloadStream.pipe(writeStream);
    downloadStream.on('error', reject);
    writeStream.on('finish', () => {
      console.log(`Saved locally: ${filename}`);
      resolve();
    });
  });
}

conn.once('open', async () => {
  gridfsBucket = new GridFSBucket(conn.db, { bucketName: 'uploads' });
  console.log('MongoDB connected');

  const files = await gridfsBucket.find().toArray();

  for (const file of files) {
    const filePath = path.join(localFolder, file.filename);
    if (fs.existsSync(filePath)) continue;
    await saveToLocal(file.filename);
  }
});

app.use('/media', express.static(localFolder));


app.post('/upload/file', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname);
  const filename = "hasan_" + crypto.randomBytes(4).toString('hex') + ext;

  const readStream = fs.createReadStream(req.file.path);
  const writeStream = gridfsBucket.openUploadStream(filename);

  readStream.pipe(writeStream)
    .on('finish', async () => {
      fs.unlinkSync(req.file.path);
      await saveToLocal(filename);
      res.json({ status: "success", response: 'file upload successful', url: `https://store.noobx-api.rf.gd/media/${filename}`, author: "♡︎ 𝐻𝐴𝑆𝐴𝑁 ♡︎" });
    })
    .on('error', () => {
      res.status(500).json({ status: "error", response: 'Upload failed', author: "♡︎ 𝐻𝐴𝑆𝐴𝑁 ♡︎" });
    });
});


app.get('/upload/url', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) return res.status(400).json({ error: 'No URL provided' });

  try {
    const ext = path.extname(fileUrl.split('?')[0]) || '.bin';
    const filename = "hasan_" + crypto.randomBytes(4).toString('hex') + ext;

    const response = await axios.get(fileUrl, { responseType: 'stream' });
    const uploadStream = gridfsBucket.openUploadStream(filename);

    response.data.pipe(uploadStream)
      .on('finish', async () => {
        await saveToLocal(filename);
        res.json({ status: "success", response: 'file uploaded successful', url: `https://store.noobx-api.rf.gd/media/${filename}`, author: "♡︎ 𝐻𝐴𝑆𝐴𝑁 ♡︎" });
      })
      .on('error', () => {
        res.status(500).json({ status: "error", response: 'file upload failed', author: "♡︎ 𝐻𝐴𝑆𝐴𝑁 ♡︎" });
      });
  } catch (err) {
    res.status(500).json({ error: 'Download failed', details: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
