const { google } = require('googleapis');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Upload video from URL to Google Drive
 * @param {string} videoUrl - Source video URL
 * @param {string} filename - Desired filename for the video
 * @param {Object} credentials - Google Service Account credentials object
 * @returns {Promise<string>} - Shareable Google Drive link
 */
async function uploadVideoToGoogleDrive(videoUrl, filename, credentials) {
  return new Promise((resolve, reject) => {
    // Download video to temp file
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, `${Date.now()}-${filename}`);
    const file = fs.createWriteStream(tempFilePath);
    
    https.get(videoUrl, (response) => {
      response.pipe(file);
      
      file.on('finish', async () => {
        file.close(async () => {
          try {
            // Initialize Google Drive API
            const auth = new google.auth.GoogleAuth({
              credentials: credentials,
              scopes: ['https://www.googleapis.com/auth/drive.file']
            });
            
            const drive = google.drive({ version: 'v3', auth });
            
            // Create file metadata
            const fileMetadata = {
              name: filename,
              parents: [] // Root folder
            };
            
            // Upload file
            const media = {
              mimeType: 'video/mp4',
              body: fs.createReadStream(tempFilePath)
            };
            
            const res = await drive.files.create({
              requestBody: fileMetadata,
              media: media,
              fields: 'id'
            });
            
            const fileId = res.data.id;
            
            // Make file publicly accessible with viewer permission
            await drive.permissions.create({
              fileId: fileId,
              requestBody: {
                role: 'reader',
                type: 'anyone'
              },
              fields: 'id'
            });
            
            // Generate shareable link
            const shareableLink = `https://drive.google.com/file/d/${fileId}/view`;
            
            // Cleanup temp file
            fs.unlinkSync(tempFilePath);
            
            resolve(shareableLink);
          } catch (error) {
            // Cleanup temp file on error
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
            reject(error);
          }
        });
      });
    }).on('error', (err) => {
      fs.unlinkSync(tempFilePath);
      reject(err);
    });
  });
}

/**
 * Validate Google Drive credentials
 * @param {Object} credentials - Google Service Account credentials
 * @returns {Promise<boolean>} - True if valid
 */
async function validateGoogleDriveCredentials(credentials) {
  try {
    if (!credentials || !credentials.client_email || !credentials.private_key) {
      return false;
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    
    const client = await auth.getClient();
    await client.getAccessToken();
    
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  uploadVideoToGoogleDrive,
  validateGoogleDriveCredentials
};
