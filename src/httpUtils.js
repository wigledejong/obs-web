const http = require('http');
const fs = require('fs');
const path = require('path');

function HttpUtils() { }

// get
HttpUtils.prototype.get = async function (url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlInfo = new URL(url)
    let opts = {}
    opts.hostname = urlInfo.hostname
    opts.path = urlInfo.pathname + urlInfo.search
    opts.port = urlInfo.port || 80
    opts.headers = options.headers || {}
    opts.timeout = options.timeout || 5000
    opts.mode = 'no-cors';
    // set timeout, default 5s
    const requestTimerID = setTimeout(() => {
      httpGet.abort()
    }, opts.timeout)

    let httpGet = http.get(opts, (res) => {
      clearTimeout(requestTimerID)
      const { statusCode, headers } = res
      let error = null
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
          `Status Code:  ${statusCode}`)
      }
      if (error) {
        res.resume()
        reject(error)
      }

      res.setEncoding('utf8')
      let rawData = ''
      res.on('data', (chunk) => {
        rawData += chunk
      })
      res.on('end', () => {
        const resData = {
          statusCode,
          headers,
          data: headers['content-type'] === 'application/json' ? JSON.parse(rawData) : rawData
        }
        resolve(resData)
      })
    }).on('error', (e) => {
      reject(e.message)
    })
  })
}

// post
HttpUtils.prototype.post = async function (url, body = {}) {
  return new Promise((resolve, reject) => {
    const urlInfo = new URL(url)

    const data = JSON.stringify(body);

    let opts = {
      hostname: urlInfo.hostname,
      path: urlInfo.pathname + urlInfo.search,
      port: urlInfo.port || 80,
      method: 'POST',
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "accept-language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "content-type": "text/plain;charset=UTF-8",
        "pragma": "no-cache",
        "x-requested-with": "XMLHttpRequest"
      },
    }
    const req = http.request(opts, (res) => {
      console.log(`STATUS: ${res.statusCode}`);
      console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
      let resData = '';
      res.on('data', (chunk) => {
        resData += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(resData));
        } catch (err) {
          reject(resData);
        }

      });
    });

    req.on('error', (e) => {
      reject(e.message);
    });

    req.write(data);
    req.end();
  })
}

//download
HttpUtils.prototype.download = function (url, fileName, options = {}) {
  return new Promise((resolve, reject) => {
    const urlInfo = new URL(url);
    var file = fs.createWriteStream(fileName, { flags: "wx" });
    let opts = {
      hostname: urlInfo.hostname,
      path: urlInfo.pathname + urlInfo.search,
      port: urlInfo.port || 80,
      headers: options.headers || {},
      timeout: options.timeout || 5000,
      mode: 'no-cors',
    }
    // set timeout, default 5s
    const requestTimerID = setTimeout(() => {
      httpGet.abort()
    }, opts.timeout)

    const request = http.get(opts, response => {
      clearTimeout(requestTimerID)
      if (response.statusCode === 200) {
        response.pipe(file);
      } else {
        file.close();
        fs.unlink(fileName, () => { }); // Delete temp file
        reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
      }
    });

    request.on("error", err => {
      file.close();
      fs.unlink(fileName, () => { }); // Delete temp file
      reject(err.message);
    });

    file.on("finish", () => {
      resolve();
    });

    file.on("error", err => {
      file.close();

      if (err.code === "EEXIST") {
        reject("File already exists");
      } else {
        fs.unlink(fileName, () => { }); // Delete temp file
        reject(err.message);
      }
    });
  });
}

// upload
HttpUtils.prototype.upload = function (url, filePath, options = {}) {

  return new Promise((resolve, reject) => {
    const urlInfo = new URL(url)

    let boundaryKey = '----WebKitFormBoundarypQg2o6On0TJpWqIk';
    let opts = {
      hostname: urlInfo.hostname,
      path: urlInfo.pathname + urlInfo.search,
      port: urlInfo.port || 80,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundaryKey,
        'Cookie': options.headers.Cookie
      }
    }

    //read file
    fs.readFile(filePath, function (err, data) {

      if (err) {
        reject(err);
        return false;
      }

      //"multipart/form-data" encoding, see https://www.w3.org/TR/html4/interact/forms.html#didx-multipartform-data
      let payloadStart = `--${boundaryKey}\r\n`;
      payloadStart += `Content-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\n`;
      payloadStart += 'Content-Type: application/octet-stream\r\n\r\n';

      let payloadEnd = '\r\n--';
      payloadEnd += boundaryKey + '--\r\n';

      // to Buffer
      const payloadBufStart = Buffer.from(payloadStart);
      const payloadBufEnd = Buffer.from(payloadEnd);

      // payloadBufStart + data + payloadBufEnd
      const payloadBufs = [payloadBufStart, data, payloadBufEnd];
      const payloadBuf = Buffer.concat(payloadBufs);

      const payloadLength = Buffer.byteLength(payloadBuf);

      const req = http.request(opts, (res) => {
        let resData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          resData += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(resData));
          } catch (err) {
            reject(resData);
          }

        });
      });

      req.on('error', (e) => {
        reject(e.message);
      });

      req.setHeader('Content-Length', payloadLength);
      req.write(payloadBuf);
      req.end();
    });
  });
}

module.exports = HttpUtils
