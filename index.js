const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket } = require('mongodb');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const mime = require('mime-types'); // ← নতুন: npm install mime-types

const app = express();
const PORT = process.env.PORT || 3000;
const server = `https://${process.env.KOYEB_PUBLIC_DOMAIN || 'noobx.koyeb.app'}`;

app.use(express.static('public'));
app.use(cors());
app.use(express.json()); // body parsing এর জন্য (যদিও বেশিরভাগ GET)

const MONGO_URI = 'mongodb+srv://toxiciter:Hasan5&7@toxiciter.9tkfu.mongodb.net/STORAGE?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const conn = mongoose.connection;
let gfs;

const tempDir = path.join(__dirname, 'temp');
const localDir = path.join(__dirname, 'File');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

const upload = multer({ dest: tempDir });

conn.once('open', () => {
  gfs = new GridFSBucket(conn.db, { bucketName: 'uploads' });

  // Startup: existing files কে local-এ sync করা (optional, production-এ সাবধানে)
  gfs.find().toArray().then(files => {
    files.forEach(file => {
      const localPath = path.join(localDir, file.filename);
      if (!fs.existsSync(localPath)) {
        const read = gfs.openDownloadStream(file._id);
        const write = fs.createWriteStream(localPath);
        read.pipe(write);
        write.on('finish', () => console.log(`Synced to local: ${file.filename}`));
      }
    });
  });
});

app.use('/media', express.static(localDir));

// Helper: safe delete
async function deleteFileByName(filename) {
  try {
    const file = await conn.db.collection('uploads.files').findOne({ filename });
    if (!file) {
      console.log(`File not found for deletion: ${filename}`);
      return;
    }
    await gfs.delete(file._id);
    console.log(`Deleted from GridFS: ${filename}`);

    // local থেকেও মুছে ফেলা
    const localPath = path.join(localDir, filename);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      console.log(`Deleted locally: ${filename}`);
    }
  } catch (err) {
    console.error(`Delete failed for ${filename}:`, err);
  }
}

// Local save helper
function saveToLocal(filename) {
  return new Promise((resolve, reject) => {
    const localPath = path.join(localDir, filename);
    if (fs.existsSync(localPath)) return resolve(); // already exists

    const read = gfs.openDownloadStreamByName(filename);
    const write = fs.createWriteStream(localPath);

    read.pipe(write)
      .on('finish', () => {
        console.log(`Saved to local: ${filename}`);
        resolve();
      })
      .on('error', reject);
  });
}

app.post('/upload-file', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { valid, privacy } = req.body;
    const originalExt = path.extname(req.file.originalname) || '.bin';
    const filename = `hasan_${crypto.randomBytes(6).toString('hex')}${originalExt}`;

    const contentType = mime.lookup(req.file.originalname) || 'application/octet-stream';

    const readStream = fs.createReadStream(req.file.path);
    const uploadStream = gfs.openUploadStream(filename, {
      contentType,
      metadata: { valid, privacy, createdAt: Date.now() }
    });

    readStream.pipe(uploadStream)
      .on('finish', async () => {
        fs.unlinkSync(req.file.path); // temp clean
        await saveToLocal(filename);

        // Temporary delete
        if (valid === 'temporary') {
          setTimeout(() => {
            deleteFileByName(filename);
          }, 24 * 60 * 60 * 1000); // 24 hours
        }

        res.json({
          status: 'success',
          url: `${server}/media/${filename}`,
          author: '♡︎ 𝐻𝐴𝑆𝐴𝐍 ♡︎'
        });
      })
      .on('error', (err) => {
        console.error('Upload stream error:', err);
        res.status(500).json({ error: 'Upload failed' });
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/upload-url', async (req, res) => {
  const { url, valid, privacy } = req.query; // ← GET-এ query থেকে নাও
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const ext = path.extname(new URL(url).pathname) || url.split("/").pop() || '.bin';
    const filename = `hasan_${crypto.randomBytes(6).toString('hex')}${ext}`;

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0 ...' } // তোমার UA
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';

    const uploadStream = gfs.openUploadStream(filename, {
      contentType,
      metadata: { valid, privacy, createdAt: Date.now() }
    });

    response.data.pipe(uploadStream)
      .on('finish', async () => {
        await saveToLocal(filename);
        if (valid === 'temporary') {
          setTimeout(() => deleteFileByName(filename), 24 * 60 * 60 * 1000);
        }
        res.json({
          status: 'success',
          url: `${server}/media/${filename}`,
          author: '♡︎ 𝐻𝐴𝑆𝐴𝐍 ♡︎'
        });
      })
      .on('error', (err) => {
        console.error('URL upload error:', err);
        res.status(500).json({ error: 'Upload failed' });
      });
  } catch (err) {
    console.error('URL fetch error:', err.message);
    res.status(500).json({ error: 'Failed to download from URL' });
  }
});

app.get('/files', async (req, res) => {
  try {
    const cursor = conn.db.collection('uploads.files').find().sort({ uploadDate: -1 });
    const files = await cursor.toArray();

    const fileList = files.map(file => {
      const filename = file.filename;
      const contentType = file.contentType || 'application/octet-stream';
      const privacy = file.metadata?.privacy || 'public';

      let filetype = 'other';
      if (contentType.startsWith('image/')) filetype = 'image';
      else if (contentType.startsWith('video/')) filetype = 'video';
      else if (contentType.startsWith('audio/')) filetype = 'audio';

      return {
        filename,
        filetype,
        privacy,
        url: `${server}/media/${filename}`,
        isDownloadable: filetype === 'other'
      };
    });

    res.json(fileList);
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} | Domain: ${server}`);
});