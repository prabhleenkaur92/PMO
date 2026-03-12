const fs = require('fs');
const path = require('path');
const multer = require('multer');

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const createStorage = (subDir) => {
  const uploadRoot = path.join(__dirname, '..', 'uploads', subDir);
  ensureDir(uploadRoot);

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadRoot),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${safeName}`);
    }
  });
};

const fileFilter = (req, file, cb) => {
  // Allow common office, text, image, archive and pdf files
  cb(null, true);
};

const limits = {
  fileSize: 20 * 1024 * 1024 // 20MB per file
};

const chatUpload = multer({
  storage: createStorage('chat'),
  fileFilter,
  limits
});

const remarkUpload = multer({
  storage: createStorage('remarks'),
  fileFilter,
  limits
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB backup upload limit
  }
});

module.exports = {
  chatUpload,
  remarkUpload,
  backupUpload
};
