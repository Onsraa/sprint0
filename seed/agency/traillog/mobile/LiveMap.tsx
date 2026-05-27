// LiveMap.tsx — React Native live tracking map.
//
// Subscribes to the route's /ws/watch socket and renders the courier moving
// along a trail with the running ETA. Reused in every app that shows a driver
// on a map (delivery, field service, ride pickup).

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';

type Position = { lat: number; lng: number };

type TrackingUpdate = Position & {
  route_id: number;
  eta_seconds: number | null;
};

interface LiveMapProps {
  routeId: number;
  wsBaseUrl: string; // e.g. wss://api.traillog.app
  destination: Position;
}

export function LiveMap({ routeId, wsBaseUrl, destination }: LiveMapProps) {
  const [driver, setDriver] = useState<Position | null>(null);
  const [trail, setTrail] = useState<Position[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${wsBaseUrl}/ws/watch/${routeId}`);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      const update: TrackingUpdate = JSON.parse(event.data);
      const next = { lat: update.lat, lng: update.lng };
      setDriver(next);
      setTrail((prev) => [...prev.slice(-50), next]); // cap trail length
      setEtaSeconds(update.eta_seconds);
    };

    return () => ws.close();
  }, [routeId, wsBaseUrl]);

  const region: Region = {
    latitude: driver?.lat ?? destination.lat,
    longitude: driver?.lng ?? destination.lng,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region}>
        {driver && (
          <Marker
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            title="Courier"
          />
        )}
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lng }}
          title="Destination"
          pinColor="green"
        />
        {trail.length > 1 && (
          <Polyline
            coordinates={trail.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeWidth={4}
          />
        )}
      </MapView>
      <View style={styles.etaBar}>
        <Text style={styles.etaText}>{formatEta(etaSeconds)}</Text>
      </View>
    </View>
  );
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return 'Locating courier…';
  const mins = Math.max(1, Math.round(seconds / 60));
  return `Arriving in ~${mins} min`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  etaBar: { padding: 12, backgroundColor: '#111' },
  etaText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
