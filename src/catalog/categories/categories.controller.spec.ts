import { CategoriesController } from './categories.controller';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

describe('CategoriesController', () => {
  let controller: CategoriesController;

  const categoriesService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CategoriesController(categoriesService as any);
  });

  it('findAll delegates to CategoriesService.findAll', async () => {
    const categories = [{ id: 'cat-1' }];
    categoriesService.findAll.mockResolvedValue(categories);

    await expect(controller.findAll()).resolves.toEqual(categories);
  });

  it('findById delegates to CategoriesService.findById with the route param', async () => {
    const category = { id: 'cat-1' };
    categoriesService.findById.mockResolvedValue(category);

    await expect(controller.findById('cat-1')).resolves.toEqual(category);
    expect(categoriesService.findById).toHaveBeenCalledWith('cat-1');
  });

  it('create delegates to CategoriesService.create with the dto', async () => {
    const dto: CreateCategoryDto = { name: 'Electronics', slug: 'electronics' };
    categoriesService.create.mockResolvedValue({ id: 'cat-1' });

    await controller.create(dto);

    expect(categoriesService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates to CategoriesService.update with the route param and dto', async () => {
    const dto: UpdateCategoryDto = { name: 'New Name' };
    categoriesService.update.mockResolvedValue({ id: 'cat-1' });

    await controller.update('cat-1', dto);

    expect(categoriesService.update).toHaveBeenCalledWith('cat-1', dto);
  });
});
