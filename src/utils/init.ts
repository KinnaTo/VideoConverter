import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

const configPath = path.join(__dirname, '../config.json');
const hostName = fs.readFileSync('/etc/hostname', 'utf8').replace('\n', '').trim();

const { token, BASE_URL } = process.env;
if (!token) {
    throw new Error('Token not found');
}
if (!BASE_URL) {
    throw new Error('BASE_URL not found');
}

const regenerateConfig = async () => {
    const res = await axios.post(
        `${BASE_URL}/api/machine`,
        {
            name: hostName,
            ip: '127.0.0.1',
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    );

    const data = res.data.machine;

    const configData = {
        id: data.id,
        token: data.token,
        name: hostName,
    };

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
};

if (!fs.existsSync(configPath)) {
    await regenerateConfig();
}

const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

try {
    const res = await axios.get(`${BASE_URL}/api/runner`, {
        headers: {
            authorization: `Bearer ${configData.token}`,
        },
    });

    const runner = res.data.runner;
    if (runner.id !== configData.id) {
        await regenerateConfig();
    }
} catch (error: any) {
    console.error(error.message);
    await regenerateConfig();
}

export default configData;
