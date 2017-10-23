// Copyright 2017 Google Inc.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.


const functions = require('firebase-functions');
const Speech = require('@google-cloud/speech');
const speech = Speech({keyFilename: "service-account-credentials.json"});
const Translate = require('@google-cloud/translate');
const translate = Translate({keyFilename: "service-account-credentials.json"});
const Encoding = Speech.v1.types.RecognitionConfig.AudioEncoding;
const Firestore = require('@google-cloud/firestore');
const getLanguageWithoutLocale = require("./utils").getLanguageWithoutLocale;

const db = new Firestore();

exports.onUploadFS = functions.firestore
    .document("/uploads/{uploadId}")
    .onWrite((event) => {
        const data = event.data.data();
        const languageCode = data.language ? data.language : "en";
        const sampleRateHertz = data.sampleRate ? parseInt(data.sampleRate, 10) : 16000;
        const encoding = data.encoding == "AMR" ? Encoding.AMR : Encoding.LINEAR16;
        const uri = `gs://${process.env.GCP_PROJECT}.appspot.com/${data.fullPath}`;

        const request = {
            config: {
                languageCode,
                sampleRateHertz,
                encoding
            },
            audio: { uri }
        };

        return speech.recognize(request).then((response) => {
            const text = response[0].results[0].alternatives[0].transcript;

            return db.collection("transcripts")
                .doc(event.params.uploadId)
                .set({
                    text, 
                    language
                });
        });
    });

exports.onTranscriptFS = functions.firestore
    .document("/transcripts/{transcriptId}")
    .onWrite((event) => {
        const value = event.data.data();
        const transcriptId = event.params.transcriptId;
        const text = value.text ? value.text : value;
        
        // All supported languages: https://cloud.google.com/translate/docs/languages
        const languages = ["en", "es", "pt", "de", "ja", "hi", "nl", "fr", "pl"];

        const from = value.language ? getLanguageWithoutLocale(value.language) : "en";

        const doc = {
            timestamp: Firestore.FieldValue.serverTimestamp(),
            languages: {}
        }
        
        const promises = languages.map(to => {
            // Call the Google Cloud Platform Translate API

            if (from == to) {
                return Promise.resolve().then(() => {
                    doc.languages[from] = text;
                });
            } else {
                return translate.translate(text, {
                    from,
                    to
                }).then(result => {
                    const translation = result[0];
                    return doc.languages[to] = translation;
                });
            }
        });
        return Promise.all(promises).then(() => {
            return db.collection("translations").doc(transcriptId).set(doc);
        });
    });
