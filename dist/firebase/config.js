"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Import the functions you need from the SDKs you need
const app_1 = require("firebase/app");
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyApkOmUN_-2yJoJdTBaFT7m1gtClrwAofo",
    authDomain: "vero-8ab69.firebaseapp.com",
    projectId: "vero-8ab69",
    storageBucket: "vero-8ab69.appspot.com",
    messagingSenderId: "195281768799",
    appId: "1:195281768799:web:54c149947f30351545e6ea"
};
// Initialize Firebase
const app = (0, app_1.initializeApp)(firebaseConfig);
exports.default = app;
