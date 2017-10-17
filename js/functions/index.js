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

const db = new Firestore();

function getLanguageWithoutLocale(languageCode) {
    if (languageCode.indexOf("-") >= 0) {
        return languageCode.substring(0, languageCode.indexOf("-"));
    }
    return languageCode;
}

exports.onUploadFS = functions.firestore
    .document("/uploads/{uploadId}")
    .onWrite((event) => {
        let data = event.data.data();
        console.log(data);
        let language = data.language ? data.language : "en";
        let sampleRate = data.sampleRate ? parseInt(data.sampleRate, 10) : 16000;
        let encoding = data.encoding == "FLAC" ? Encoding.FLAC : Encoding.LINEAR16;

        let request = {
            config: {
                languageCode : language,
                sampleRateHertz : sampleRate,
                encoding : encoding
            },
            audio: { uri : `gs://${process.env.GCP_PROJECT}.appspot.com/${data.fullPath}` }
        };

        console.log(request);

        return speech.recognize(request).then((response) => {
            let transcript = response[0].results[0].alternatives[0].transcript;
            return db.collection("transcripts").doc(event.params.uploadId).set({text: transcript, language: language});
        });
    });

exports.onTranscriptFS = functions.firestore
    .document("/transcripts/{transcriptId}")
    .onWrite((event) => {
        let value = event.data.data();
        let transcriptId = event.params.transcriptId;
        let text = value.text ? value.text : value;
        let languages = ["en", "es", "pt", "de", "ja", "hi", "nl", "fr", "pl"];
        // All supported languages: https://cloud.google.com/translate/docs/languages

        let from = value.language ? getLanguageWithoutLocale(value.language) : "en";
        let promises = languages.map(to => {
            console.log(`translating from '${from}' to '${to}', text '${text}'`);
            // Call the Google Cloud Platform Translate API

            if (from == to) {
                return db.collection("translations").doc(transcriptId).set({to: {text: text, language: from}}, {merge: true});
            } else {
                return translate.translate(text, {
                    from: from,
                    to: to
                }).then(result => {
                    // Write the translation to the database
                    let translation = result[0];
                    return db.collection("translations").doc(transcriptId).set({to: {text: translation, language: to}}, {merge: true});
                });
            }
        });
        return Promise.all(promises);
    });
