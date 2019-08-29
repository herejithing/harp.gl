/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeometryKind } from "@here/harp-datasource-protocol";
import * as THREE from "three";
import { Tile, TileObject } from "../Tile";

function overlayObject(object: TileObject, displacementMap: THREE.DataTexture): void {
    if (!("material" in object)) {
        return;
    }

    const material = (object as any).material;

    if ("displacementMap" in material) {
        (material as any).displacementMap = displacementMap;
    }
}

/**
 * Overlays the geometry in the given tile on top of elevation data if available.
 *
 * @param tile The tile whose geometry will be overlaid.
 */
export function overlayOnElevation(tile: Tile): void {
    const elevationProvider = tile.mapView.elevationProvider;

    if (elevationProvider === undefined || tile.objects.length === 0) {
        return;
    }
    const displacementMap = elevationProvider.getDisplacementMap(tile.tileKey);
    if (displacementMap === undefined || tile.objects.length === 0) {
        return;
    }

    const firstObject = tile.objects[0];
    if (
        !firstObject.userData ||
        !firstObject.userData.kind ||
        !firstObject.userData.kind.find((kind: GeometryKind) => {
            return kind !== GeometryKind.All && kind !== GeometryKind.Terrain;
        })
    ) {
        return;
    }

    for (const object of tile.objects) {
        overlayObject(object, displacementMap.texture);
    }
}