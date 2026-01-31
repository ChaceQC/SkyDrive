import axios from 'axios';

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 60000,
});

request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

request.interceptors.response.use(
  (response) => {
    // If the responseType is 'blob', return the entire response object
    // so the caller can access response.data (the Blob) and other properties like headers.
    // if (response.config.responseType === 'blob') {
    //   return response;
    // }
    return response.data;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default request;