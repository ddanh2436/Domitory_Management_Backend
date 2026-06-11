export class CreateRoomDto {
  name!: string;
  building!: string;
  floor!: number;
  capacity!: number;
  currentOccupancy?: number;
  price!: number;
  status?: string;
  facilities?: string[];
}
