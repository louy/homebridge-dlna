const fetch = require('node-fetch');
const parser = require('fast-xml-parser');
const MediaRendererClient = require('upnp-mediarenderer-client');

const NodeCast = require('nodecast-js');
const nodeCast = new NodeCast();

async function findDevices() {
  return nodeCast.getList();
}
async function getDeviceStatus() {}
async function updateDevice() {}

module.exports = function(homebridge) {
  const {platformAccessory: Accessory, hap: {Service, Characteristic, uuid: UUIDGen}} = homebridge;

  class DLNA {
    constructor(log, config, api) {
      log("DLNA Init");
      this.log = log;
      this.accessories = [];

      this.config = config = (config || {});
      config.username = config.username || process.env.SALUS_USERNAME;
      config.password = config.password || process.env.SALUS_PASSWORD;

      for (const key of ['username','password']) {
        if (!config[key]) {
          throw new Error('Missing config key: '+key);
        }
      }

      this.api = api;
      this.api.on('didFinishLaunching', () => this.didFinishLaunching());
    }

    async didFinishLaunching() {
      this.log('Did finish launching')

      const registerDevice = async (device) =>{
        const response = await fetch(device.xml);
        const xml = parser.parse(await response.text());
        device.meta = xml.root.device;

        device.client = new MediaRendererClient(device.xml);

        const uuid = UUIDGen.generate(device.meta.UDN || device.host);

        let accessory = this.accessories.find(a => a.UUID === uuid);
        if (accessory) {
        } else {
          accessory = new Accessory(device.name, uuid);
          this.accessories.push(accessory);
          this.api.registerPlatformAccessories("homebridge-dlna", "DLNA", [accessory]);
        }

        accessory.context.host = device.host;

        accessory.reachable = true;

        accessory.on('identify', (paired, callback) => {
          this.log(accessory.displayName, "Identify!!!");
          callback();
        });

        const infoService = accessory.getService(Service.AccessoryInformation) ||
                            accessory.addService(Service.AccessoryInformation, "Speaker");
        infoService
          .setCharacteristic(Characteristic.Manufacturer, device.meta.manufacturer)
          .setCharacteristic(Characteristic.Model, device.meta.modelName)
          .setCharacteristic(Characteristic.Name, device.meta.ssidName)
          .setCharacteristic(Characteristic.SerialNumber, device.meta.uuid)
          .setCharacteristic(Characteristic.FirmwareRevision, 'N/A')

        const speakerService = accessory.getService(Service.Speaker) ||
                               accessory.addService(Service.Speaker, "Speaker");
        speakerService
          .getCharacteristic(Characteristic.Mute)
          .on('get', (callback) => {
            device.client.getVolume((err, volume) => {
              if (volume !== 0) device.lastKnownVolume = volume;
              callback(err, volume === 0)
            })
          })
          .on('set', (value, callback) => {
            device.client.setVolume(value ? device.lastKnownVolume || 10 : 0, callback)
          });
        speakerService
          .getCharacteristic(Characteristic.Volume)
          .on('get', (callback) => {
            device.client.getVolume((err, volume) => {
              if (volume !== 0) device.lastKnownVolume = volume;
              callback(err, volume)
            })
          })
          .on('set', (value, callback) => {
            device.client.setVolume(value, callback)
          });
      }

      nodeCast.onDevice(device => {
        console.log(device);

        device.onError(err => {
          console.log(err);
        });

        registerDevice(device)

        // console.log(nodeCast.getList()); // list of currently discovered devices
      });

      nodeCast.start();

      // discover devices
      const devices = await findDevices()
      this.log('Found ' + devices.length + ' devices');

      for (const device of devices) {
        await registerDevice(device);
      }
    }

    // Function invoked when homebridge tries to restore cached accessory.
    // Developer can configure accessory at here (like setup event handler).
    // Update current value.
    async configureAccessory(accessory) {
      this.accessories.push(accessory)
      // FIXME
      // this.api.unregisterPlatformAccessories("homebridge-dlna", "DLNA", [accessory]);
    }
  }

  homebridge.registerPlatform("homebridge-dlna", "DLNA", DLNA, true);
}
