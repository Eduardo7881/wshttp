/**
* WSHttp version 0.1
* Testing mode script
*
* + Licensed under MIT License
*/

const WebSocket = require("ws");
const express = require("express");
const { Buffer } = require("buffer");

const app = express();
const PORT = 3000;
const IP = "0.0.0.0"; // all interfaces by default

let latestFrame = []; // Flat array of {r,g,b}

const RECONNECT = true; // RECONNECT?

function connectToVNC() {
    const ws = new WebSocket("ws://localhost:5901"); // websocket server address
    console.log("[WSHTTP] Connecting to Websockify Server...");

    ws.binaryType = 'arraybuffer';

    ws.on("open", () => {
        console.log("[WSHTTP] WebSocket open. Beginning VNC handshake...");
    });

    let stage = 0;
    let width = 0;
    let height = 0;

    ws.on("message", (data) => {
        const buf = Buffer.from(data);

        if (stage === 0) {
            // Protocol version
            const version = buf.toString("ascii");
            console.log("[WSHTTP] VNC Server version:", version);
            ws.send("RFB 003.008\n"); // HANDSHAKE RESPONSE
            stage++;
        } else if (stage === 1) {
            // Security
            const secType = buf[0];
            if (secType === 1) {
                ws.send(Buffer.from([1])); // No authentication
                stage++;
            } else {
                console.error("Unsupported security type:", secType);
            }
        } else if (stage === 2) {
            // Security Result
            if (buf.readUInt32BE(0) !== 0) {
                console.error("[WSHTTP] VNC Authentication Failed.");
                ws.close();
            } else {
                console.log("[WSHTTP] Authentication passed. Sending ClientInit...");
                ws.send(Buffer.from([1])); // Shared flag
                stage++;
            }
        } else if (stage === 3) {
            // ServerInit
            width = buf.readUInt16BE(0);
            height = buf.readUInt16BE(2);
            console.log("Screen size:", width, "x", height);
            stage++;

            requestFramebuffer(ws, width, height);
        } else {
            // framebufferupdate
            parseFramebufferUpdate(buf, width, height);
            requestFramebuffer(ws, width, height);
        }
    });

    ws.on("close", () => {
        console.warn("Disconnected.");
        if (RECONNECT) {
            console.warn("Retrying in 5s...");
            setTimeout(connectToVNC, 5000);
        } else {
            process.exit(1);
        }
    });
}

function requestFramebuffer(ws, width, height) {
    const buf = Buffer.alloc(10);
    buf[0] = 3;
    buf[1] = 0;
    buf.writeUInt16BE(0, 2); // x
    buf.writeUInt16BE(0, 4); // y
    buf.writeUInt16BE(width, 6);
    buf.writeUInt16BE(height, 8);
    ws.send(buf);
}

function parseFramebufferUpdate(buf, width, height) {
    const numberOfRectangles = buf.readUInt16BE(2);
    let offset = 4;

    for (let i = 0; i < numberOfRectangles; i++) {
        const x = buf.readUInt16BE(offset);
        const y = buf.readUInt16BE(offset + 2);
        const w = buf.readUInt16BE(offset + 4);
        const h = buf.readUInt16BE(offset + 6);
        const encoding = buf.readUInt16BE(offset + 8);
        offset += 12;

        if (encoding === 0) {
            // RAW encoding
            const pixelData = buf.slice(offset, offset + w * h * 4);
            offset += w * h * 4;

            latestFrame = [];
            for (let j = 0; j < pixelData.length; j += 4) {
                latestFrame.push({
                    r: pixelData[j],
                    g: pixelData[j + 1],
                    b: pixelData[j + 2],
                });
            }

            console.log(`[WSHTTP] Framebuffer update: ${w}x${h}`);
        } else {
            console.error("[WSHTTP] Unsupported encoding:", encoding);
            process.exit(1);
        }
    }
}

/**
 * If you're testing, disable this line to connect to vnc
 */
//connectToVNC();

/**
 * Testing code
 */
setInterval(() => {
    latestFrame = [];
    for (let i = 0; i < 10000; i++) {
        latestFrame.push({
            r: Math.random() * 255,
            g: Math.random() * 255,
            b: Math.random() * 255,
        });
    }
}, 100);
/** */

// HTTP Server
app.get("/frame", (req, res) => {
    res.json(latestFrame);
});

app.listen(PORT, IP, () => {
    console.log(`HTTP Server running on "${IP}" with port: ${PORT}`);
});
