"use strict";

const fs = require('fs');
const path = require('path');
var http = require('http');
// const speech = require("@google-cloud/speech");
// const client = new speech.SpeechClient();
var HttpDispatcher = require('httpdispatcher');
var WebSocketServer = require('websocket').server;
var crypto = require('crypto');
var awsSign = require("./awsSignature");
let recognizeStream = null;

// const awsSdk = require('aws-sdk');

// const transcribeService = new awsSdk.TranscribeService();

const { request } = require('http2-client');
const aws4 = require('aws4');

var dispatcher = new HttpDispatcher();
var wsserver = http.createServer(handleRequest);

const HTTP_SERVER_PORT = process.env.PORT || 9090;
var accessKeyIdEnv = process.env.AWS_ACCESS_KEY_ID;
var secretAccessKeyEnv = process.env.AWS_SECRET_ACCESS_KEY;

var mediaws = new WebSocketServer({
  httpServer: wsserver,
  autoAcceptConnections: true,
});

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

function handleRequest(request, response){
  try {
    dispatcher.dispatch(request, response);
  } catch(err) {
    console.error(err);
  }
}

function getAmzDate() {
  var dateStr = new Date().toISOString()
 var chars = [":","-"];
 for (var i=0;i<chars.length;i++) {
   while (dateStr.indexOf(chars[i]) != -1) {
     dateStr = dateStr.replace(chars[i],"");
   }
 }
 dateStr = dateStr.split(".")[0] + "Z";
 return dateStr;
}

function createPresignedUrl(opts) {
  let endpoint = opts.host;
  let languageCode = "en-US";
  let region = "us-east-1";
  let sampleRate = 48000;
  // get a preauthenticated URL that we can use to establish our WebSocket
  return awsSign.createPresignedURL(
      'POST',
      endpoint,
      '/stream-transcription',
      'transcribe',
      crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
          'key': accessKeyIdEnv,
          'secret': secretAccessKeyEnv,
          'protocol': 'https',
          'expires': 15,
          'region': region,
          'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
      }
  );
}


dispatcher.onPost('/twiml', function(req,res) {
  log('POST TwiML');
  
  var filePath = path.join(__dirname+'/templates', 'streams.xml');
  var stat = fs.statSync(filePath);
  log(filePath);
  res.writeHead(200, {
    'Content-Type': 'text/xml',
    'Content-Length': stat.size
  });

  var readStream = fs.createReadStream(filePath);
  log("readstream",readStream)
  readStream.pipe(res);
});

mediaws.on('connect', function(connection) {
  log('Media WS: Connection accepted');
  new TranscriptionStream(connection);
});

class MediaStream {
  constructor(connection) {
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
    this.hasSeenMedia = false;
    this.messageCount = 0;
  }

  processMessage(message){
    if (message.type === 'utf8') {
      var data = JSON.parse(message.utf8Data);
      if (data.event === "connected") {
        log('Media WS: Connected event received: ', data);
        recognizeStream = client
          .streamingRecognize(request)
          .on("error", console.error)
          .on("data", data => {
            console.log(data.results[0].alternatives[0].transcript);
          });
      }
      if (data.event === "start") {
        log('Media WS: Start event received: ', data);
// const request1 = {
//   config: {
//     encoding: "MULAW",
//     sampleRateHertz: 8000,
//     languageCode: "en-GB"
//   },
//   interimResults: true
// };

// recognizeStream = client
//           .streamingRecognize(request1)
//           .on("error", console.error)
//           .on("data", data => {
//             console.log(data.results[0].alternatives[0].transcript);
//           });
      }
      if (data.event === "media") {
        if (!this.hasSeenMedia) {
          log('Media WS: Media event received: ', data);
          log('Media WS: Suppressing additional messages...');
          this.hasSeenMedia = true;
        }
      }
      if (data.event === "close") {
        log('Media WS: Close event received: ', data);
// recognizeStream = client
//           .streamingRecognize(request)
//           .on("error", console.error)
//           .on("data", data => {
//             console.log(data.results[0].alternatives[0].transcript);
//           });
        this.close();
      }
      this.messageCount++;
    } else if (message.type === 'binary') {
      log('Media WS: binary message received (not supported)');
    }
  }

  close(){
    log('Media WS: Closed. Received a total of [' + this.messageCount + '] messages');
  }
}

class TranscriptionStream {
  constructor(connection) {
    this.streamCreatedAt = null;
    this.stream = null;

    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }

  processMessage(message){
    if (message.type === 'utf8') {
      var data = JSON.parse(message.utf8Data);
      // Only worry about media messages
      //transcribestreaming.us-east-1.amazonaws.com	
      if (data.event !== "media") {
        return;
      }
      this.getStream(data.media.payload);
      console.log('Payload from Twilio:',Buffer.from(payload))
// recognizeStream = client
//           .streamingRecognize(request)
//           .on("error", console.error)
//           .on("data", data => {
//             console.log(data.results[0].alternatives[0].transcript);
//           });
        this.close();
    } else if (message.type === 'binary') {
      log('Media WS: binary message received (not supported)');
    }
  }

  close(){
    log('Media WS: closed');

    if (this.stream){
      this.stream.destroy();
    }
  }

  newStreamRequired() {
    if(!this.stream) {
      return true;
    } else {
      const now = new Date();
      const timeSinceStreamCreated = (now - this.streamCreatedAt);
      return (timeSinceStreamCreated/1000) > 60;
    }
  }

  getStream(payload) {
    
   
    var opts = {
      service: 'transcribe',
      region: 'us-east-1',
      protocol: 'https:',
      method: 'POST',
      host: 'transcribestreaming.us-east-1.amazonaws.com',
      path: '/stream-transcription',
   
      headers: {
        'x-amzn-transcribe-language-code': 'en-US',
        'x-amzn-transcribe-sample-rate': 48000,
        'x-amzn-transcribe-media-encoding': 'pcm',
        'X-Amz-Algorithm':'AWS4-HMAC-SHA256',
        'x-amz-target': 'com.amazonaws.transcribe.Transcribe.StartStreamTranscription',
        'X-Amz-Date':getAmzDate(),
        'Content-Type':'application/vnd.amazon.eventstream'
      },
      body: JSON.stringify({
        AudioStream: {
          AudioEvent: {
            AudioChunk: Buffer.from(payload, 'base64'),
          }
        }
      })
    };
    
    
    console.log('access',accessKeyIdEnv);
    console.log('secret',secretAccessKeyEnv);
    // var urlObj = aws4.sign(opts, {accessKeyId:accessKeyIdEnv, secretAccessKey:secretAccessKeyEnv});
    var urlObj = createPresignedUrl(opts);
    
    opts.headers.Authorization = urlObj;
    console.log("awsKey",opts);
    const req = request(opts);
   
    req.on('response', (response, flags) => {
      console.log('RESPONSE', { response, flags });
    });
   
    req.on('data', (chunk) => {
      const data = JSON.parse(chunk.toString());
      console.log('DATA', { data });
    });
   
    req.on('error', (error) => {
      console.log('ERROR', { error });
    });
   
    req.on('end', () => {
      console.log('END', { payload });
    });
   
    req.end();
  }

    // return this.stream;

  onTranscription(data){
    var result = data.results[0];
    if (result === undefined || result.alternatives[0] === undefined) {
      return;
    }

    var transcription = result.alternatives[0].transcript;
    console.log((new Date()) + 'Transcription: ' + transcription);
  }
}

wsserver.listen(HTTP_SERVER_PORT, function(){
  console.log("Server listening on: http://localhost:%s", HTTP_SERVER_PORT);
});
