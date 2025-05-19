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

// Local folders
const tempDir = path.join(__dirname, 'temp');
const localFolder = path.join(__dirname, 'File');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(localFolder)) fs.mkdirSync(localFolder);

// Multer setup
const upload = multer({ dest: tempDir });

// Save file from GridFS to local File folder
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

// MongoDB connection
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

// Serve static files
app.use('/media', express.static(localFolder));

// Upload from device
app.post('/upload/file', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname);
  const filename = crypto.randomBytes(16).toString('hex') + ext;

  const readStream = fs.createReadStream(req.file.path);
  const writeStream = gridfsBucket.openUploadStream(filename);

  readStream.pipe(writeStream)
    .on('finish', async () => {
      fs.unlinkSync(req.file.path);
      await saveToLocal(filename); // save to File/ after upload
      res.json({ message: 'Uploaded', url: `/media/${filename}` });
    })
    .on('error', () => {
      res.status(500).json({ error: 'Upload failed' });
    });
});

// Upload from URL
app.get('/upload/url', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) return res.status(400).json({ error: 'No URL provided' });

  try {
    const ext = path.extname(fileUrl.split('?')[0]) || '.bin';
    const filename = crypto.randomBytes(16).toString('hex') + ext;

    const response = await axios.get(fileUrl, { responseType: 'stream' });
    const uploadStream = gridfsBucket.openUploadStream(filename);

    response.data.pipe(uploadStream)
      .on('finish', async () => {
        await saveToLocal(filename); // save to File/ after upload
        res.json({ message: 'Uploaded', url: `/media/${filename}` });
      })
      .on('error', () => {
        res.status(500).json({ error: 'GridFS upload failed' });
      });
  } catch (err) {
    res.status(500).json({ error: 'Download failed', details: err.message });
  }
});

// Serve from GridFS directly
/*app.get('/media/:filename', (req, res) => {
  gridfsBucket.find({ filename: req.params.filename }).toArray((err, files) => {
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const downloadStream = gridfsBucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
  });
});*/

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
