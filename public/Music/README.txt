Place your music files (.mp3, .ogg, .wav, .m4a, .flac, .webm) in this folder.

Naming convention:
  01 - Song Title.mp3              → title: "Song Title", artist: "Unknown Artist"
  02 - Song Name -- Artist.mp3    → title: "Song Name",  artist: "Artist"
  Cool Track.ogg                   → title: "Cool Track", artist: "Unknown Artist"

Files are sorted by filename, so prefix with numbers (01, 02...) to set the default order.

After adding/removing files, run from the WORD-FALL folder:
  node scan-music.js

This generates tracks.json which the game auto-loads on startup.
Players can still reorder songs and create custom playlists in the in-game Music menu.
