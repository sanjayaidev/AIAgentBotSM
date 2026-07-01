# Google Drive Upload & Video.js Integration Guide

This guide explains how to use the public endpoints for uploading videos to Google Drive and integrating with Video.js player.

## Table of Contents

1. [Public API Endpoints](#public-api-endpoints)
2. [Video.js Integration](#videojs-integration)
3. [Usage Examples](#usage-examples)
4. [Google Service Account Setup](#google-service-account-setup)

---

## Public API Endpoints

### 1. Upload Video to Google Drive (Public - No Auth Required)

**Endpoint:** `POST /api/public/upload-to-drive`

Anyone can use this endpoint to upload videos from any URL to Google Drive.

#### Request Body

```json
{
  "videoUrl": "https://example.com/video.mp4",
  "filename": "my-video.mp4",
  "credentials": {
    "client_email": "your-service-account@project.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
    "project_id": "your-project-id"
  }
}
```

#### Response

```json
{
  "success": true,
  "shareableLink": "https://drive.google.com/file/d/FILE_ID/view",
  "directStreamUrl": "https://drive.google.com/uc?export=download&id=FILE_ID",
  "originalUrl": "https://example.com/video.mp4",
  "message": "Video successfully uploaded to Google Drive"
}
```

#### Error Response

```json
{
  "error": "Invalid Google Drive credentials",
  "details": "Failed to upload video to Google Drive",
  "help": "Ensure your Google Service Account has Drive API enabled and proper permissions"
}
```

---

### 2. Get Shareable Link for Existing File

**Endpoint:** `GET /api/public/drive-link/:fileId`

Generate a shareable link and direct stream URL for an existing Google Drive file.

#### Query Parameters

- `credentials` (required): Google Service Account credentials as JSON string

#### Example

```bash
curl "http://localhost:3000/api/public/drive-link/FILE_ID?credentials=$(echo '{"client_email":"...","private_key":"..."}' | jq -Rs @uri)"
```

#### Response

```json
{
  "success": true,
  "fileId": "FILE_ID",
  "shareableLink": "https://drive.google.com/file/d/FILE_ID/view",
  "directStreamUrl": "https://drive.google.com/uc?export=download&id=FILE_ID",
  "embedUrl": "https://drive.google.com/file/d/FILE_ID/preview"
}
```

---

## Video.js Integration

The application includes enhanced Video.js integration with Google Drive upload functionality.

### Available Functions

All functions are globally available via `window` object:

#### 1. `openVideoPlayerEnhanced(videoUrl, options)`

Open the Video.js player with enhanced features.

```javascript
openVideoPlayerEnhanced('https://drive.google.com/file/d/FILE_ID/view', {
  showShare: true,      // Show "Share to Drive" button
  filename: 'video.mp4', // Default filename for sharing
  paused: false,        // Start paused
  type: 'video/mp4'     // MIME type
});
```

#### 2. `uploadAndPlayVideo(videoUrl, filename, credentials)`

Upload a video to Google Drive and automatically play it.

```javascript
const credentials = {
  client_email: 'your-service-account@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
  project_id: 'your-project-id'
};

await uploadAndPlayVideo(
  'https://example.com/video.mp4',
  'my-video.mp4',
  credentials
);
```

#### 3. `shareVideoToDrive(videoUrl, filename)`

Share a video to Google Drive with a credential prompt.

```javascript
// Opens a prompt for credentials
await shareVideoToDrive(
  'https://example.com/video.mp4',
  'my-video.mp4'
);
```

#### 4. `getShareableLink(fileId, credentials)`

Get shareable link for an existing Google Drive file.

```javascript
const result = await getShareableLink('FILE_ID', credentials);
console.log(result.shareableLink);
console.log(result.directStreamUrl);
```

#### 5. `convertDriveLinkEnhanced(viewLink)`

Convert various Google Drive URL formats to direct stream URLs.

```javascript
// Converts: https://drive.google.com/file/d/FILE_ID/view
// To:       https://drive.google.com/uc?export=download&id=FILE_ID

const directUrl = convertDriveLinkEnhanced('https://drive.google.com/file/d/FILE_ID/view');
```

---

## Usage Examples

### Example 1: Upload and Play Video

```html
<!DOCTYPE html>
<html>
<head>
  <title>Video Upload Example</title>
  <link href="https://vjs.zencdn.net/8.6.1/video-js.css" rel="stylesheet" />
</head>
<body>
  <button onclick="uploadVideo()">Upload & Play Video</button>
  
  <div id="videoPlayerContainer" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:10000;">
    <div style="position:absolute; top:10px; right:20px; z-index:10001;">
      <button onclick="closeVideoPlayer()" style="background:#dc2626; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">✕ Close</button>
    </div>
    <div style="display:flex; align-items:center; justify-content:center; height:100%;">
      <video id="videoPlayer" class="video-js vjs-default-skin" controls preload="auto" width="640" height="360"></video>
    </div>
  </div>

  <script src="https://vjs.zencdn.net/8.6.1/video.min.js"></script>
  <script src="/js/app.js"></script>
  <script>
    async function uploadVideo() {
      const credentials = {
        client_email: 'your-service-account@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
        project_id: 'your-project-id'
      };
      
      try {
        await uploadAndPlayVideo(
          'https://example.com/my-video.mp4',
          'my-video.mp4',
          credentials
        );
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
    
    function closeVideoPlayer() {
      document.getElementById('videoPlayerContainer').style.display = 'none';
      if (typeof videoPlayer !== 'undefined' && videoPlayer) {
        videoPlayer.pause();
      }
    }
  </script>
</body>
</html>
```

### Example 2: Direct API Call (cURL)

```bash
# Upload video to Google Drive
curl -X POST http://localhost:3000/api/public/upload-to-drive \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://example.com/video.mp4",
    "filename": "my-video.mp4",
    "credentials": {
      "client_email": "your-service-account@project.iam.gserviceaccount.com",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
      "project_id": "your-project-id"
    }
  }'
```

### Example 3: JavaScript Fetch

```javascript
async function uploadVideo() {
  const response = await fetch('/api/public/upload-to-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoUrl: 'https://example.com/video.mp4',
      filename: 'my-video.mp4',
      credentials: {
        client_email: 'your-service-account@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
        project_id: 'your-project-id'
      }
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('Shareable link:', result.shareableLink);
    console.log('Direct stream URL:', result.directStreamUrl);
    
    // Play in Video.js
    openVideoPlayerEnhanced(result.shareableLink);
  } else {
    console.error('Upload failed:', result.error);
  }
}
```

---

## Google Service Account Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one

### Step 2: Enable Google Drive API

1. In the Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Google Drive API"
3. Click **Enable**

### Step 3: Create Service Account

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **Service Account**
3. Fill in the details and click **Create**
4. Grant the service account access to Google Drive (optional step during creation)

### Step 4: Create Service Account Key

1. Select your service account
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Choose **JSON** format
5. Download the key file

### Step 5: Extract Credentials

From the downloaded JSON file, extract these fields:

```json
{
  "client_email": "your-service-account@project.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "project_id": "your-project-id"
}
```

### Security Notes

- ⚠️ **Never expose your private key in client-side code in production**
- Use environment variables or secure secret management
- The public endpoints still require valid credentials - they just don't require server API key authentication
- Consider implementing rate limiting for public endpoints

---

## Supported Google Drive URL Formats

The `convertDriveLinkEnhanced` function supports these formats:

| Format | Example |
|--------|---------|
| View link | `https://drive.google.com/file/d/FILE_ID/view` |
| Preview link | `https://drive.google.com/file/d/FILE_ID/preview` |
| Open link | `https://drive.google.com/open?id=FILE_ID` |
| Direct link | `https://drive.google.com/uc?export=download&id=FILE_ID` |

All formats are automatically converted to direct stream URLs compatible with Video.js.

---

## Troubleshooting

### "Invalid Google Drive credentials"

- Ensure the service account JSON is valid
- Check that the private key includes the full `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers
- Verify the Drive API is enabled in your Google Cloud project

### "Permission denied"

- The service account needs permission to access/create files in Drive
- For existing files, share them with the service account's email address

### Video doesn't play in Video.js

- Ensure you're using the direct stream URL (`/uc?export=download&id=...`)
- Some browsers may block autoplay - user interaction may be required
- Check CORS settings if hosting videos externally

---

## API Reference Summary

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/api/public/upload-to-drive` | POST | No (credentials in body) | Upload video from URL to Google Drive |
| `/api/public/drive-link/:fileId` | GET | No (credentials in query) | Get shareable link for existing file |
| `/api/upload-to-drive` | POST | Yes (server API key) | Upload video (authenticated users only) |

---

For more information, check the main README.md or contact support.
