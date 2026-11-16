"use strict";
/* 舊版 Google 登入（Firebase）設定，只用來把舊資料搬到試算表 */
/* 舊版 Google 登入（Firebase）只用來把舊資料搬到試算表，平常不會載入 */
const firebaseConfig = {
  apiKey: "AIzaSyDC5IQZiYhiUonGIPtKAzRBfaqzlbl1K1c",
  authDomain: "timeblock-janice.firebaseapp.com",
  projectId: "timeblock-janice",
  storageBucket: "timeblock-janice.firebasestorage.app",
  messagingSenderId: "1070313389626",
  appId: "1:1070313389626:web:b4bc84454959bbd41bbf03",
  measurementId: "G-MSM9D1NKLV"
};
const FBV = "https://www.gstatic.com/firebasejs/10.12.2/";
let FB = null;
async function loadFB(){
  if (FB) return FB;
  const [a, b, c] = await Promise.all([import(FBV + "firebase-app.js"), import(FBV + "firebase-auth.js"), import(FBV + "firebase-firestore.js")]);
  return (FB = Object.assign({}, a, b, c));
}
