export class SearchRoomDto {
  page?: number;
  limit?: number;
  name?: string;
  building?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
}