const express = require('express');
const ping = require('ping');
const network = require('network');
const ip = require('ip');
const { exec } = require('child_process');

const cors = require('cors');

const app = express();
const port = 3000;


const dns = require('dns');
const os = require('os'); // You can use this if the node provides a hostname
const exec2 = require('child_process').exec;


// Enable CORS for all routes
app.use(cors());

// Serve the HTML and CSS files
app.use(express.static('public'));

let nodeStatus  = {}; // Store last-known status of nodes

// Function to get local network address (subnet)
function getLocalNetwork() {
    return new Promise((resolve, reject) => {
        network.get_private_ip((err, ipAddress) => {
            if (err) {
                reject(err);
            } else {
                const networkAddress = ipAddress.split('.').slice(0, 3).join('.');
                resolve(networkAddress);
            }
        });
    });
}

// Function to get MAC address using arp-scan
function getMacAddress(ipAddress) {
  return new Promise((resolve, reject) => {
      // Use 'arp -a' to get the MAC address associated with an IP
      exec(`arp -a ${ipAddress}`, (error, stdout, stderr) => {
          if (error) {
              reject(`Error: ${stderr}`);
          } else {
              // Adjust the regex to correctly match MAC addresses in your output format
              const regex = /(?:[0-9a-fA-F]{2}[-:]){5}[0-9a-fA-F]{2}/;
              const match = stdout.match(regex);
              if (match) {
                  resolve(match[0]); // Return the MAC address
              } else {
                  resolve(null); // No MAC found
              }
          }
      });
  });
}

// Function to get a more meaningful name for the device
function getDeviceName(ipAddress) {
    return new Promise((resolve, reject) => {
        // First, try to resolve the IP address with DNS reverse lookup
        dns.reverse(ipAddress, (err, hostnames) => {
            if (err || !hostnames || hostnames.length === 0) {
                // If reverse DNS lookup fails, try pinging the device to get its hostname
                exec2(`ping -a ${ipAddress}`, (error, stdout, stderr) => {
                    if (error || stderr) {
                        resolve(`Unknown Device (${ipAddress})`);
                    } else {
                        // Extract the hostname from the ping response (if possible)
                        const match = stdout.match(/([a-zA-Z0-9.-]+)\s+\[.*\]/);
                        if (match && match[1]) {
                            resolve(match[1]);
                        } else {
                            resolve(`Unknown Device (${ipAddress})`);
                        }
                    }
                });
            } else {
                // Return the first hostname found
                resolve(hostnames[0]);
            }
        });
    });
}

// Function to check and notify on network changes with 10s delay tracking
async function monitorNetwork() {
  try {
      const networkAddress = await getLocalNetwork();
      const pingPromises = [];
      
      // Ping IPs from 1 to 254
      for (let i = 1; i <= 254; i++) {
          pingPromises.push(ping.promise.probe(`${networkAddress}.${i}`));
      }
      
      const results = await Promise.all(pingPromises);
      const currentNodes = {}; // Store nodes found in this scan

      for (const result of results) {
          if (result.alive) {
              const macAddress = await getMacAddress(result.host);
              currentNodes[result.host] = { mac: macAddress };
          }
      }

      const currentTime = Date.now();

      // Process online nodes
      for (const ip in currentNodes) {
          if (!nodeStatus[ip]) {
              nodeStatus[ip] = { mac: currentNodes[ip].mac, lastOnline: currentTime, lastOffline: null, online: true };
              console.log(`Notification: Node ${ip} (MAC: ${currentNodes[ip].mac}) came online.`);
          } else if (!nodeStatus[ip].online && (currentTime - nodeStatus[ip].lastOffline >= 180000)) {
              nodeStatus[ip].online = true;
              nodeStatus[ip].lastOnline = currentTime;
              console.log(`Notification: Node ${ip} (MAC: ${currentNodes[ip].mac}) came online.`);
          } else {
              nodeStatus[ip].lastOnline = currentTime;
          }
      }

      // Process offline nodes
      for (const ip in nodeStatus) {
          if (!currentNodes[ip]) {
              if (nodeStatus[ip].online && (currentTime - nodeStatus[ip].lastOnline >= 180000)) {
                  nodeStatus[ip].online = false;
                  nodeStatus[ip].lastOffline = currentTime;
                  console.log(`Notification: Node ${ip} (MAC: ${nodeStatus[ip].mac}) went offline.`);
              } else if (!nodeStatus[ip].online) {
                  nodeStatus[ip].lastOffline = currentTime;
              }
          }
      }
  } catch (error) {
      console.error("Network monitoring error:", error);
  }
}

// Monitor network every 30 seconds 
setInterval(monitorNetwork, 300000);

// API endpoint to scan the network
app.get('/scan', async (req, res) => {
  try {
      const networkAddress = await getLocalNetwork();
      const pingPromises = [];

      // Scan IPs from 1 to 254 in the local subnet
      for (let i = 1; i <= 254; i++) {
          const target = `${networkAddress}.${i}`;
          pingPromises.push(ping.promise.probe(target));
      }
      const results = await Promise.all(pingPromises);
      // console.log('Ping Results:', results);  // Log ping results
      const onlineNodes = [];
      for (const result of results) {
          if (result.alive) {
              const macAddress = await getMacAddress(result.host);
              // console.log(`MAC for ${result.host}:`, macAddress);  // Log MAC address
              const deviceName = await getDeviceName(result.host);
              onlineNodes.push({
                  ip: result.host,
                  mac: macAddress || 'Not Available', // Handle cases with no MAC address
                  name: deviceName // Set the resolved device name
              });
          }
      }
      // Log the final list of online nodes
      console.log('Online Nodes:', onlineNodes);
      // Return the list of online devices with IP, MAC address, and name
      res.json(onlineNodes);
  } catch (error) {
      console.error(error);
      res.status(500).send("Error scanning network");
  }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
