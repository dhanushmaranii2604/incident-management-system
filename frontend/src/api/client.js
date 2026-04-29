import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export const api = axios.create({ baseURL: BASE });

export const fetchWorkItems  = ()       => api.get('/api/workitems').then(r => r.data);
export const fetchWorkItem   = (id)     => api.get(`/api/workitems/${id}`).then(r => r.data);
export const updateStatus    = (id, payload) => api.patch(`/api/workitems/${id}/status`, payload).then(r => r.data);
export const ingestSignal    = (signal) => api.post('/api/signals', signal).then(r => r.data);
export const fetchHealth     = ()       => api.get('/health').then(r => r.data);
