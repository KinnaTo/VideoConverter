import axios from 'axios';
import config from './init';

const api = axios.create({
    baseURL: `${process.env.BASE_URL}/api`,
    headers: {
        authorization: `Bearer ${config.token}`,
    },
});

export default api;
