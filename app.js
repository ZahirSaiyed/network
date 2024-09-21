// app.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

// Load notes from file
const notesFilePath = path.join(__dirname, 'notes.json');
let notesStore = {};

if (fs.existsSync(notesFilePath)) {
  const data = fs.readFileSync(notesFilePath);
  notesStore = JSON.parse(data);
}

function saveNotesToFile() {
  fs.writeFileSync(notesFilePath, JSON.stringify(notesStore));
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Configure Passport to use Google OAuth
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
  // Store the access token in the user object
  profile.accessToken = accessToken;
  return done(null, profile);
}));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/auth/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'https://www.googleapis.com/auth/contacts.other.readonly',
    ],
    accessType: 'offline',
    prompt: 'consent',
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/contacts');
  });

  app.get('/contacts', async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.redirect('/');
    }
  
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: req.user.accessToken });
  
    const peopleService = google.people({ version: 'v1', auth: oauth2Client });
  
    try {
      const response = await peopleService.otherContacts.list({
        pageSize: 1000, // Adjust as needed
        readMask: 'names,emailAddresses,metadata',
      });
  
      const connections = response.data.otherContacts || [];
  
      // Create an array of contacts with updateTime
      const contacts = connections.map(person => {
        const email = person.emailAddresses ? person.emailAddresses[0].value : '';
        const name = person.names ? person.names[0].displayName : '';
        let updateTime = null;
  
        if (person.metadata && person.metadata.sources && person.metadata.sources.length > 0) {
          updateTime = person.metadata.sources[0].updateTime;
        }
  
        return {
          name,
          email,
          note: notesStore[email] || '',
          updateTime,
        };
      });
  
      // Sort contacts in reverse chronological order based on updateTime
      contacts.sort((a, b) => {
        if (a.updateTime && b.updateTime) {
          return new Date(b.updateTime) - new Date(a.updateTime);
        } else if (a.updateTime) {
          return -1;
        } else if (b.updateTime) {
          return 1;
        } else {
          return 0;
        }
      });
  
      // Render the contacts template
      res.render('contacts', { contacts });
    } catch (error) {
      console.error('Error fetching contacts:', error);
      res.send('Error fetching contacts.');
    }
  });  

app.post('/save-note', (req, res) => {
  const { email, note } = req.body;
  notesStore[email] = note;
  saveNotesToFile();
  res.redirect('/contacts');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`App is running on http://localhost:${PORT}`);
});
